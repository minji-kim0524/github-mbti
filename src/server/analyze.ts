import type { GitHubActivity } from './github.js'

// 개발자 MBTI 4축 판정 (초안). 축 이름·기준값은 추후 변경 예정이라 이 파일에 모아 둔다.
// 순수 함수로만 구성해 GitHub API 없이도 테스트할 수 있게 한다.

/** 커밋 시각 데이터가 없어 시간대를 감지할 수 없을 때 쓰는 기본값 */
export const DEFAULT_TIME_ZONE = 'Asia/Seoul'

/** 새벽형으로 보는 시간대: 20:00 ~ 04:59 */
const NIGHT_START_HOUR = 20
const NIGHT_END_HOUR = 5

const THRESHOLDS = {
  /** 새벽 시간대 커밋 비율이 이 이상이면 N */
  night: 0.4,
  /** 1년 중 기여한 날 비율이 이 이상이면 S */
  steady: 0.35,
  /** 가장 많이 쓴 언어 비율이 이 이상이면 F */
  focus: 0.6,
  /** 남의 저장소 커밋 비율이 이 이상이면 T */
  team: 0.25,
  /** PR + 리뷰 수가 이 이상이면 T */
  teamActivity: 30,
}

export type Axis = {
  key: 'time' | 'rhythm' | 'scope' | 'collab'
  label: string
  /** 판정된 글자 */
  letter: string
  /** 판정된 쪽 이름 (예: "새벽형") */
  trait: string
  /** 왼쪽·오른쪽 끝 이름 (카드 막대 표시용) */
  left: { letter: string; name: string }
  right: { letter: string; name: string }
  /** 왼쪽 성향 비율 0~1 */
  score: number
  /** 판정 근거 한 줄. "71% (새벽 20~05시 커밋)" 처럼 비율을 먼저 쓰고 설명은 괄호에 넣는다 */
  evidence: string
  /** 데이터가 부족해 기본값으로 판정했는지 */
  insufficient: boolean
}

export type MbtiResult = {
  login: string
  /** 최근 1년 공개 활동이 하나도 없으면 false (유형을 판정하지 않음) */
  measurable: boolean
  type: string
  nickname: string
  /** 판정에 쓴 시간대. 자동 감지면 가장 많이 쓴 오프셋 (예: "UTC+9"), 지정했다면 IANA 이름 */
  timeZone: string
  /** tz 를 지정하지 않아 커밋 시각의 오프셋으로 판정했는지 */
  timeZoneAutoDetected: boolean
  axes: Axis[]
}

const percent = (value: number) => `${Math.round(value * 100)}%`

/** 유효한 IANA 시간대인지 확인 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

function hourIn(timestamp: string, timeZone: string): number | null {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date)
  return Number(hour)
}

// GitTimestamp 는 UTC 로 변환되지 않고 작성자의 오프셋을 유지한다 (예: 2026-10-18T23:14:58+09:00).
// 따라서 문자열의 시(hour)가 곧 작성자의 현지 시각이다.
const GIT_TIMESTAMP = /T(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

type LocalTime = { hour: number; offset: string }

function parseLocalTime(timestamp: string): LocalTime | null {
  const match = GIT_TIMESTAMP.exec(timestamp)
  if (!match?.[1] || !match[2]) return null
  const raw = match[2]
  const offset = raw === 'Z' ? '+00:00' : raw.includes(':') ? raw : `${raw.slice(0, 3)}:${raw.slice(3)}`
  return { hour: Number(match[1]), offset }
}

/** "+09:00" → "UTC+9", "+05:30" → "UTC+5:30", "+00:00" → "UTC" */
function offsetLabel(offset: string): string {
  const sign = offset[0]
  const hours = Number(offset.slice(1, 3))
  const minutes = offset.slice(4, 6)
  if (hours === 0 && minutes === '00') return 'UTC'
  return `UTC${sign}${hours}${minutes === '00' ? '' : `:${minutes}`}`
}

/** 가장 많이 쓴 오프셋. 동률이면 먼저 나온(최근) 쪽을 고른다. */
function dominantOffset(times: LocalTime[]): string | null {
  const counts = new Map<string, number>()
  for (const { offset } of times) counts.set(offset, (counts.get(offset) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [offset, count] of counts) {
    if (count > bestCount) {
      best = offset
      bestCount = count
    }
  }
  return best
}

/** 커밋마다 판정에 쓸 현지 시(hour). tz 가 없으면 각 커밋의 자기 오프셋 기준 시각을 쓴다. */
function commitHours(activity: GitHubActivity, timeZone: string | undefined): number[] {
  const hours = timeZone
    ? activity.commitTimestamps.map((t) => hourIn(t, timeZone))
    : activity.commitTimestamps.map((t) => parseLocalTime(t)?.hour ?? null)
  return hours.filter((h): h is number => h !== null)
}

function timeAxis(activity: GitHubActivity, timeZone: string | undefined): Axis {
  const hours = commitHours(activity, timeZone)
  const night = hours.filter((h) => h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR).length
  const ratio = hours.length ? night / hours.length : 0
  const isNight = ratio >= THRESHOLDS.night
  return {
    key: 'time',
    label: '시간',
    letter: isNight ? 'N' : 'D',
    trait: isNight ? '새벽형' : '아침형',
    left: { letter: 'N', name: '새벽형' },
    right: { letter: 'D', name: '아침형' },
    score: ratio,
    evidence: hours.length ? `${percent(ratio)} (새벽 20~05시 커밋)` : '커밋 시각 데이터 부족',
    insufficient: hours.length === 0,
  }
}

function rhythmAxis(activity: GitHubActivity): Axis {
  const days = activity.calendar.length
  const active = activity.calendar.filter((d) => d.count > 0).length
  const ratio = days ? active / days : 0
  const isSteady = ratio >= THRESHOLDS.steady
  return {
    key: 'rhythm',
    label: '리듬',
    letter: isSteady ? 'S' : 'B',
    trait: isSteady ? '꾸준형' : '몰아치기형',
    left: { letter: 'S', name: '꾸준형' },
    right: { letter: 'B', name: '몰아치기형' },
    score: ratio,
    evidence: `${percent(ratio)} (1년 중 ${active}일 기여)`,
    insufficient: active === 0,
  }
}

function scopeAxis(activity: GitHubActivity): Axis {
  const weights = new Map<string, number>()
  for (const repo of activity.repositories) {
    if (!repo.language) continue
    weights.set(repo.language, (weights.get(repo.language) ?? 0) + repo.commitDays)
  }
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0)
  const [topLanguage, topWeight] = [...weights.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  const ratio = total ? topWeight / total : 0
  const isFocus = total === 0 || ratio >= THRESHOLDS.focus
  return {
    key: 'scope',
    label: '범위',
    letter: isFocus ? 'F' : 'E',
    trait: isFocus ? '한 우물형' : '잡식형',
    left: { letter: 'F', name: '한 우물형' },
    right: { letter: 'E', name: '잡식형' },
    score: ratio,
    evidence: total ? `${percent(ratio)} (${topLanguage} · 언어 ${weights.size}개)` : '언어 데이터 부족',
    insufficient: total === 0,
  }
}

function collabAxis(activity: GitHubActivity): Axis {
  const login = activity.login.toLowerCase()
  const total = activity.repositories.reduce((sum, r) => sum + r.commitDays, 0)
  const others = activity.repositories
    .filter((r) => r.owner.toLowerCase() !== login)
    .reduce((sum, r) => sum + r.commitDays, 0)
  const otherRatio = total ? others / total : 0
  const teamActivity = activity.totals.pullRequests + activity.totals.reviews
  const isTeam = otherRatio >= THRESHOLDS.team || teamActivity >= THRESHOLDS.teamActivity
  return {
    key: 'collab',
    label: '협업',
    letter: isTeam ? 'T' : 'L',
    trait: isTeam ? '협업형' : '솔로형',
    left: { letter: 'L', name: '솔로형' },
    right: { letter: 'T', name: '협업형' },
    score: 1 - otherRatio,
    evidence: `${percent(otherRatio)} (남의 저장소 커밋 · PR ${activity.totals.pullRequests} · 리뷰 ${activity.totals.reviews})`,
    insufficient: total === 0 && teamActivity === 0,
  }
}

// 별명은 축별 수식어를 이어 붙여 만든다 (16개를 따로 짓지 않아도 되고, 이름 변경이 쉬움)
const NICKNAME_PARTS: Record<string, string> = {
  N: '새벽의',
  D: '햇살 아래',
  S: '꾸준한',
  B: '몰아치는',
  F: '한 우물',
  E: '잡식',
  L: '솔로 장인',
  T: '팀 플레이어',
}

/**
 * @param timeZone IANA 시간대. 생략하면 커밋 시각의 오프셋으로 자동 감지한다.
 */
export function analyze(activity: GitHubActivity, timeZone?: string): MbtiResult {
  const offset = timeZone ? null : dominantOffset(activity.commitTimestamps.map(parseLocalTime).filter((t) => t !== null))
  // 자동 감지할 커밋 시각이 없으면 기본 시간대로 판정한다
  const effectiveTimeZone = timeZone ?? (offset ? undefined : DEFAULT_TIME_ZONE)
  const axes = [timeAxis(activity, effectiveTimeZone), rhythmAxis(activity), scopeAxis(activity), collabAxis(activity)]
  return {
    login: activity.login,
    measurable: activity.calendar.some((d) => d.count > 0) || activity.commitTimestamps.length > 0,
    type: axes.map((a) => a.letter).join(''),
    nickname: axes.map((a) => NICKNAME_PARTS[a.letter]).join(' '),
    timeZone: offset ? offsetLabel(offset) : (timeZone ?? DEFAULT_TIME_ZONE),
    timeZoneAutoDetected: offset !== null,
    axes,
  }
}
