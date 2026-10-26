import { describe, expect, test } from '@jest/globals'
import { analyze, isValidTimeZone, type Axis } from '../src/server/analyze.js'
import type { GitHubActivity } from '../src/server/github.js'
import { calendarOf, commitsAt, makeActivity, repo } from './fixtures.js'

function axisOf(activity: GitHubActivity, key: Axis['key'], timeZone?: string): Axis {
  const axis = analyze(activity, timeZone).axes.find((a) => a.key === key)
  if (!axis) throw new Error(`${key} 축이 없어요`)
  return axis
}

describe('시간 축 (시간당 커밋 수로 비교)', () => {
  test('새벽 9시간·낮 15시간에 같은 수를 커밋하면 새벽 밀도가 높아 N', () => {
    // 450/9 = 50, 450/15 = 30 → 50 / 80 = 62.5%
    const axis = axisOf(makeActivity({ commitTimestamps: [...commitsAt(23, 450), ...commitsAt(10, 450)] }), 'time')
    expect(axis.letter).toBe('N')
    expect(axis.score).toBeCloseTo(0.625)
    expect(axis.evidence).toBe('63% (시간당 커밋 수 · 새벽 20~05시 450개)')
  })

  test('커밋 수 비율이 44%여도 시간당 밀도로는 새벽이 높아 N', () => {
    const axis = axisOf(makeActivity({ commitTimestamps: [...commitsAt(1, 44), ...commitsAt(14, 56)] }), 'time')
    expect(axis.letter).toBe('N')
    expect(axis.score).toBeGreaterThan(0.5)
  })

  test('두 구간의 밀도가 같으면(9 : 15) 경계값 50%로 N', () => {
    const axis = axisOf(makeActivity({ commitTimestamps: [...commitsAt(22, 9), ...commitsAt(9, 15)] }), 'time')
    expect(axis.score).toBeCloseTo(0.5)
    expect(axis.letter).toBe('N')
  })

  test('새벽 밀도가 조금이라도 낮으면 D, 근거는 낮 쪽 비율', () => {
    const axis = axisOf(makeActivity({ commitTimestamps: [...commitsAt(22, 8), ...commitsAt(9, 15)] }), 'time')
    expect(axis.letter).toBe('D')
    expect(axis.evidence).toMatch(/^\d+% \(시간당 커밋 수 · 오전·낮 05~20시 15개\)$/)
  })

  test('새벽 구간 경계: 20시는 새벽, 05시는 낮', () => {
    expect(axisOf(makeActivity({ commitTimestamps: commitsAt(20, 1) }), 'time').letter).toBe('N')
    expect(axisOf(makeActivity({ commitTimestamps: commitsAt(4, 1) }), 'time').letter).toBe('N')
    expect(axisOf(makeActivity({ commitTimestamps: commitsAt(5, 1) }), 'time').letter).toBe('D')
  })

  test('자동 감지면 커밋에 기록된 현지 시각, tz 를 지정하면 그 시간대로 바꿔 판정', () => {
    // 23:30+09:00 = 14:30 UTC
    const activity = makeActivity({ commitTimestamps: commitsAt(23, 3) })
    expect(axisOf(activity, 'time').letter).toBe('N')
    expect(axisOf(activity, 'time', 'UTC').letter).toBe('D')
  })

  test('커밋 시각이 없으면 데이터 부족', () => {
    const axis = axisOf(makeActivity(), 'time')
    expect(axis.insufficient).toBe(true)
    expect(axis.evidence).toBe('커밋 시각 데이터 부족')
  })
})

describe('리듬 축 (기여한 날 비율 50%)', () => {
  test('1년의 절반 이상 기여하면 S', () => {
    const axis = axisOf(makeActivity({ calendar: calendarOf(366, 183) }), 'rhythm')
    expect(axis.letter).toBe('S')
    expect(axis.evidence).toBe('50% (1년 중 183일 기여)')
  })

  test('절반에 하루라도 못 미치면 R, 근거는 쉰 날 비율', () => {
    const axis = axisOf(makeActivity({ calendar: calendarOf(366, 182) }), 'rhythm')
    expect(axis.letter).toBe('R')
    expect(axis.evidence).toBe('50% (1년 중 184일 쉬고 182일 기여)')
  })

  test('기여가 없으면 데이터 부족', () => {
    expect(axisOf(makeActivity({ calendar: calendarOf(365, 0) }), 'rhythm').insufficient).toBe(true)
  })
})

describe('범위 축 (최다 언어 비율 60%)', () => {
  test('커밋한 날 수로 가중한 최다 언어가 60% 이상이면 F', () => {
    const repositories = [repo({ language: 'TypeScript', commitDays: 6 }), repo({ language: 'Python', commitDays: 4 })]
    const axis = axisOf(makeActivity({ repositories }), 'scope')
    expect(axis.letter).toBe('F')
    expect(axis.evidence).toBe('60% (TypeScript · 언어 2개)')
  })

  test('최다 언어가 60% 미만이면 M', () => {
    const repositories = [
      repo({ language: 'TypeScript', commitDays: 59 }),
      repo({ language: 'Python', commitDays: 41 }),
    ]
    const axis = axisOf(makeActivity({ repositories }), 'scope')
    expect(axis.letter).toBe('M')
    expect(axis.evidence).toBe('41% (TypeScript 외 언어 1개)')
  })

  test('같은 언어의 저장소는 합산하고, 언어가 없는 저장소는 뺀다', () => {
    const repositories = [
      repo({ language: 'Go', commitDays: 3 }),
      repo({ language: 'Go', commitDays: 3 }),
      repo({ language: 'Rust', commitDays: 4 }),
      repo({ language: null, commitDays: 100 }),
    ]
    const axis = axisOf(makeActivity({ repositories }), 'scope')
    expect(axis.score).toBeCloseTo(0.6)
    expect(axis.letter).toBe('F')
  })

  test('언어 데이터가 없으면 F 로 두고 데이터 부족 표시', () => {
    const axis = axisOf(makeActivity(), 'scope')
    expect(axis.letter).toBe('F')
    expect(axis.insufficient).toBe(true)
  })
})

describe('협업 축 (팀 저장소 커밋한 날 + 팀 PR + 리뷰 비율 50%)', () => {
  const totals = makeActivity().totals

  test('팀 저장소 커밋 비율이 50% 이상이면 T', () => {
    const repositories = [repo({ owner: 'octocat', commitDays: 1 }), repo({ owner: 'some-org', commitDays: 1 })]
    expect(axisOf(makeActivity({ repositories }), 'collab').letter).toBe('T')
  })

  test('팀 활동 비율이 50% 미만이면 A', () => {
    const repositories = [repo({ owner: 'octocat', commitDays: 51 }), repo({ owner: 'some-org', commitDays: 49 })]
    expect(axisOf(makeActivity({ repositories }), 'collab').letter).toBe('A')
  })

  test('팀 PR 과 리뷰도 팀 활동으로 한 건씩 센다', () => {
    const repositories = [repo({ owner: 'octocat', commitDays: 60 }), repo({ owner: 'some-org', commitDays: 20 })]
    const axis = axisOf(
      makeActivity({ repositories, totals: { ...totals, teamPullRequests: 10, reviews: 30 } }),
      'collab',
    )
    expect(axis.letter).toBe('T')
    expect(axis.evidence).toBe('50% (팀 저장소 커밋 20일 · 팀 PR 10 · 리뷰 30)')
  })

  test('PR 과 리뷰가 많아도 내 저장소 커밋이 더 많으면 A 이고, 강조 쪽 비율이 더 크다', () => {
    const repositories = [repo({ owner: 'octocat', commitDays: 90 })]
    const axis = axisOf(
      makeActivity({ repositories, totals: { ...totals, teamPullRequests: 10, reviews: 20 } }),
      'collab',
    )
    expect(axis.letter).toBe('A')
    expect(axis.score).toBeGreaterThanOrEqual(0.5)
    expect(axis.evidence).toBe('75% (내 저장소 커밋 90일 · 팀 PR 10 · 리뷰 20)')
  })

  test('커밋 없이 리뷰만 했어도 판정한다', () => {
    const axis = axisOf(makeActivity({ totals: { ...totals, reviews: 5 } }), 'collab')
    expect(axis.letter).toBe('T')
    expect(axis.insufficient).toBe(false)
  })

  test('활동이 하나도 없으면 데이터 부족', () => {
    expect(axisOf(makeActivity(), 'collab').insufficient).toBe(true)
  })

  test('저장소 소유자는 대소문자를 구분하지 않고 내 저장소로 본다', () => {
    const repositories = [repo({ owner: 'OctoCat', commitDays: 10 })]
    expect(axisOf(makeActivity({ repositories }), 'collab').letter).toBe('A')
  })
})

describe('analyze 결과', () => {
  test('네 축의 글자로 유형을, 글자별 수식어로 별명을 만든다', () => {
    const result = analyze(
      makeActivity({
        commitTimestamps: commitsAt(23, 5),
        calendar: calendarOf(10, 8),
        repositories: [repo({ owner: 'some-org', language: 'Go', commitDays: 5 })],
      }),
    )
    expect(result.type).toBe('NSFT')
    expect(result.nickname).toBe('새벽의 꾸준한 한 우물 팀 플레이어')
  })

  test('커밋 시각의 오프셋 중 가장 많은 것을 시간대로 표시한다', () => {
    const result = analyze(
      makeActivity({ commitTimestamps: [...commitsAt(10, 3, '+09:00'), ...commitsAt(10, 1, '-05:30')] }),
    )
    expect(result.timeZone).toBe('UTC+9')
    expect(result.timeZoneAutoDetected).toBe(true)
  })

  test('tz 를 지정하면 그 이름을 그대로 쓰고, 커밋 시각이 없으면 기본 시간대', () => {
    expect(analyze(makeActivity({ commitTimestamps: commitsAt(10, 1) }), 'America/New_York').timeZone).toBe(
      'America/New_York',
    )
    const empty = analyze(makeActivity())
    expect(empty.timeZone).toBe('Asia/Seoul')
    expect(empty.timeZoneAutoDetected).toBe(false)
  })

  test('최근 1년 공개 활동이 하나도 없으면 측정할 수 없다', () => {
    expect(analyze(makeActivity({ calendar: calendarOf(365, 0) })).measurable).toBe(false)
    expect(analyze(makeActivity({ calendar: calendarOf(365, 1) })).measurable).toBe(true)
  })
})

describe('isValidTimeZone', () => {
  test('IANA 시간대 이름만 허용한다', () => {
    expect(isValidTimeZone('Asia/Seoul')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('<script>')).toBe(false)
  })
})
