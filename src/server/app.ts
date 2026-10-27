import { waitUntil } from '@vercel/functions'
import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import { analyze, isValidTimeZone } from './analyze.js'
import { CARD_LAYOUTS, CARD_THEMES, renderCard, renderErrorCard } from './card.js'
import { fetchGitHubActivity, GitHubRateLimitedError, GitHubUserNotFoundError, type GitHubRateLimit } from './github.js'
import { createActivityStore, type StoredActivity } from './store.js'

// GitHub username 규칙: 영숫자와 하이픈, 최대 39자, 하이픈으로 시작 불가
const GITHUB_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/

/**
 * 저장한 결과를 최신으로 보는 기간. 이보다 오래된 결과는 기존 카드를 그대로 보여 주면서,
 * 뒤에서 GitHub 커밋 내역을 새로 받아 바뀐 내용을 반영한다 (새 커밋이 1시간 단위로 반영되게 하면서 rate limit 을 아낀다)
 */
const FRESH_MS = 60 * 60 * 1000
/** 오래된 결과를 보여 줄 때 다시 확인하는 간격. 다른 인스턴스가 새로 받아 저장했는지도 이 간격으로 다시 읽는다 */
const STALE_RECHECK_MS = 60 * 1000
/** 같은 아이디를 GitHub 에서 새로 받는 동안 다른 인스턴스가 중복으로 받지 않도록 맡아 두는 시간(초) */
const REFRESH_CLAIM_S = 60
/** 캐시 기간이 지난 뒤 하루 동안은 CDN 이 이전 카드를 바로 보여 주면서 뒤에서 새로 만든다 */
const STALE_WHILE_REVALIDATE_S = 24 * 60 * 60
const ERROR_CACHE_CONTROL = 'public, max-age=300'
// 요청 제한 응답은 CDN 에 남으면 다른 사람에게도 보이므로 캐싱하지 않는다
const NO_STORE = 'no-store'

/**
 * 캐시에 없는 아이디를 새로 조회할 수 있는 횟수 (IP당, 10분마다 초기화).
 * 서로 다른 아이디를 대량으로 요청해 GitHub 토큰 한도(5,000포인트/시간)를 소진시키는 것을 막는다.
 * 캐시된 아이디 조회는 세지 않는다. 기록은 인스턴스 메모리에 있어 인스턴스마다 따로 센다
 */
const LOOKUP_LIMIT = 30
const LOOKUP_WINDOW_MS = 10 * 60 * 1000
/**
 * GitHub 토큰의 남은 포인트가 이 값 이하이면 캐시에 없는 아이디의 새 조회를 멈춘다.
 * IP 제한은 인스턴스마다 따로 세어 여러 IP 로 나눠 요청하면 토큰을 다 쓸 수 있으므로, GitHub 가 알려 주는 토큰 전체 기준으로 한 번 더 막는다.
 * 새 조회는 쿼리 2번(실측 2포인트)이라, 남겨 둔 몫은 저장된 결과를 새로 받는 데 쓴다
 */
const NEW_LOOKUP_RESERVE_POINTS = 500
/** 남은 포인트가 이 값 이하이면 1시간이 지난 결과도 새로 받지 않고 그대로 쓴다 */
const REFRESH_RESERVE_POINTS = 100
/** GitHub 가 한도 초과로 거절하면 다시 채워질 시각을 알 수 없으므로, 이 시간 동안 부르지 않는다 */
const RATE_LIMITED_BACKOFF_MS = 10 * 60 * 1000
/** 메모리 캐시·요청 제한 기록이 끝없이 늘지 않도록 두는 최대 항목 수 (전체 결과는 저장소에 남아 있다) */
const MAX_CACHED_USERS = 1000
const MAX_TRACKED_CLIENTS = 5000
/** 오류 메시지에 되돌려 보여 줄 tz 의 최대 길이 */
const MAX_ECHO_LENGTH = 40

const UNMEASURABLE_MESSAGE = '최근 1년 공개 활동이 없어 MBTI를 측정할 수 없어요.'

/**
 * 카드 응답을 기다리는 최대 시간. GitHub 이미지 프록시(camo)는 약 4.2초 안에 응답이 끝나지 않으면 이미지를 깨뜨리고,
 * 헤더만 도착하고 본문이 잘리면 빈 이미지를 그대로 캐싱한다. 콜드 스타트(실측 최대 2초 이상)·네트워크 시간을 빼고 여유를 두어 1.5초로 잡는다
 */
const CARD_TIME_BUDGET_MS = 1500
const PREPARING_MESSAGE = '카드를 만드는 중이에요. 잠시 후 새로고침해 주세요.'

/** 시간대를 커밋 시각으로 자동 감지하라는 tz 값 */
const AUTO_TIME_ZONE = 'auto'

class MissingTokenError extends Error {}
class RateLimitedError extends Error {}

// GitHub 가 마지막으로 알려 준 토큰 전체의 남은 포인트. 인스턴스마다 자기 조회 응답으로 갱신한다 (아직 모르면 막지 않는다)
let githubBudget = { remaining: Number.POSITIVE_INFINITY, resetAt: 0 }

function recordRateLimit({ remaining, resetAt }: GitHubRateLimit) {
  githubBudget = { remaining, resetAt: Date.parse(resetAt) }
}

/** 남은 포인트가 reserve 보다 많거나, 다시 채워질 시각이 지났으면 GitHub 를 불러도 된다 */
function canCallGitHub(reserve: number): boolean {
  return githubBudget.remaining > reserve || Date.now() >= githubBudget.resetAt
}

/** 만료된 항목을 지우고, 그래도 많으면 먼저 넣은 것부터 지운다 */
function prune<V>(map: Map<string, V>, max: number, isExpired: (value: V) => boolean) {
  if (map.size <= max) return
  for (const [key, value] of map) if (isExpired(value)) map.delete(key)
  for (const key of map.keys()) {
    if (map.size <= max) break
    map.delete(key)
  }
}

// 요청한 곳(IP) → 이번 구간에 새로 조회한 횟수
const lookupCounts = new Map<string, { resetAt: number; count: number }>()

/** 새 조회를 한 번 쓴다. 한도를 넘었으면 false */
function consumeLookup(client: string): boolean {
  const now = Date.now()
  const entry = lookupCounts.get(client)
  if (!entry || entry.resetAt <= now) {
    // 같은 키를 덮어쓰면 예전 순서가 유지돼 가장 먼저 지워지므로, 지운 뒤 맨 뒤에 다시 넣는다
    lookupCounts.delete(client)
    lookupCounts.set(client, { resetAt: now + LOOKUP_WINDOW_MS, count: 1 })
    prune(lookupCounts, MAX_TRACKED_CLIENTS, (e) => e.resetAt <= now)
    return true
  }
  entry.count += 1
  return entry.count <= LOOKUP_LIMIT
}

// 아이디(소문자) → 조회 결과와 저장 시각. 만료 없이 계속 보관해 README 에 붙인 카드가 오래 조회되지 않아도 남아 있게 한다
const store = createActivityStore()

async function readStored(key: string): Promise<StoredActivity | undefined> {
  try {
    return await store.get(key)
  } catch (error) {
    // 저장소를 못 읽으면 메모리에 있는 결과를 쓰거나 GitHub 에서 새로 조회한다
    console.error(error)
    return undefined
  }
}

async function fetchAndStore(login: string, key: string, token: string): Promise<StoredActivity> {
  const activity = await fetchGitHubActivity(login, token, recordRateLimit).catch((error: unknown) => {
    if (error instanceof GitHubRateLimitedError) {
      githubBudget = { remaining: 0, resetAt: Date.now() + RATE_LIMITED_BACKOFF_MS }
    }
    throw error
  })
  const stored = { savedAt: Date.now(), activity }
  // 저장에 실패해도 이번 조회 결과는 그대로 쓴다
  await store.set(key, stored).catch(console.error)
  return stored
}

/** 메모리에 없는 아이디: 저장소에 있으면 그대로 쓰고, 처음 보는 아이디만 GitHub 에서 조회한다 */
async function loadFirst(login: string, key: string, token: string, client: string): Promise<StoredActivity> {
  const stored = await readStored(key)
  if (stored) return stored
  // 토큰 기준을 먼저 보아, 막힌 요청이 IP 횟수까지 쓰지 않게 한다
  if (!canCallGitHub(NEW_LOOKUP_RESERVE_POINTS) || !consumeLookup(client)) throw new RateLimitedError()
  return fetchAndStore(login, key, token)
}

/** 최신 결과를 받아 온다. 다른 인스턴스가 이미 새로 받아 두었거나 받는 중이면 GitHub 를 부르지 않는다 */
async function refresh(login: string, key: string, token: string): Promise<StoredActivity | undefined> {
  const latest = await readStored(key)
  if (latest && Date.now() - latest.savedAt <= FRESH_MS) return latest
  if (!canCallGitHub(REFRESH_RESERVE_POINTS)) return latest
  const claimed = await store.claimRefresh(key, REFRESH_CLAIM_S).catch((error: unknown) => {
    // 저장소에 문제가 있어도 새로 받는 것은 막지 않는다
    console.error(error)
    return true
  })
  if (!claimed) return latest
  return fetchAndStore(login, key, token)
}

type MemoryEntry = {
  /** 가장 최근에 받은 결과. 오래돼도 지우지 않고, 새 결과를 받기 전까지 그대로 보여 준다 */
  stored?: StoredActivity
  /** 처음 불러오는 중인 결과. 같은 아이디의 동시 요청이 함께 기다린다 */
  loading?: Promise<StoredActivity>
  /** 뒤에서 최신 결과를 받는 중인 작업 */
  refreshing?: Promise<void>
  /** 마지막으로 최신 결과를 확인한 시각 */
  checkedAt: number
}

// 서버 메모리 캐시 (아이디 소문자 → 결과). 저장소 앞에 두어 같은 인스턴스의 반복 요청을 빠르게 처리한다
const memory = new Map<string, MemoryEntry>()

/** 저장한 지 1시간이 지난 결과면 응답은 기존 결과로 하고, 최신 결과는 뒤에서 받아 바꿔 둔다 (1분에 한 번만 확인) */
function revalidateIfStale(login: string, key: string, token: string, entry: MemoryEntry) {
  const now = Date.now()
  if (!entry.stored || now - entry.stored.savedAt <= FRESH_MS) return
  if (entry.refreshing || now - entry.checkedAt < STALE_RECHECK_MS) return
  entry.checkedAt = now
  entry.refreshing = refresh(login, key, token)
    .then((latest) => {
      if (latest && latest.savedAt > (entry.stored?.savedAt ?? 0)) entry.stored = latest
    })
    // 새로 받지 못하면 기존 결과를 계속 보여 준다
    .catch(console.error)
    .finally(() => (entry.refreshing = undefined))
  waitUntil(entry.refreshing)
}

function getStored(login: string, client: string): Promise<StoredActivity> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new MissingTokenError()

  const key = login.toLowerCase()
  const existing = memory.get(key)
  // 최근에 쓴 항목이 정리 때 늦게 지워지도록 맨 뒤로 옮긴다
  if (existing) {
    memory.delete(key)
    memory.set(key, existing)
  }
  if (existing?.stored) {
    revalidateIfStale(login, key, token, existing)
    return Promise.resolve(existing.stored)
  }
  if (existing?.loading) return existing.loading

  const entry: MemoryEntry = { checkedAt: 0 }
  memory.set(key, entry)
  prune(memory, MAX_CACHED_USERS, () => false)
  entry.loading = loadFirst(login, key, token, client).then(
    (stored) => {
      entry.stored = stored
      entry.loading = undefined
      revalidateIfStale(login, key, token, entry)
      return stored
    },
    (error: unknown) => {
      // 실패한 결과는 캐시하지 않는다
      if (memory.get(key) === entry) memory.delete(key)
      throw error
    },
  )
  return entry.loading
}

/** 결과가 최신인 동안만 캐싱하고, 오래된 결과는 1분만 캐싱해 뒤에서 받은 새 결과로 곧 바뀌게 한다 */
function resultCacheControl(savedAt: number): string {
  const fresh = Math.ceil((savedAt + FRESH_MS - Date.now()) / 1000)
  const maxAge = Math.max(fresh, STALE_RECHECK_MS / 1000)
  return `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`
}

/** ms 안에 끝나면 결과를, 아니면 undefined 를 돌려준다. 원래 작업은 멈추지 않는다 */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: Parameters<typeof clearTimeout>[0]
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

type Outcome =
  | { ok: true; result: ReturnType<typeof analyze>; savedAt: number }
  | { ok: false; status: 400 | 404 | 429 | 500; message: string }

/** 오류 응답의 캐시 정책. 요청 제한은 요청한 사람에게만 해당하므로 캐싱하지 않는다 */
function errorCacheControl(status: number): string {
  return status === 429 ? NO_STORE : ERROR_CACHE_CONTROL
}

/** 요청한 곳을 구분하는 키. Vercel 은 x-real-ip 에 실제 접속 IP 를 넣는다 (로컬은 없음) */
function clientKey(c: Context): string {
  return c.req.header('x-real-ip') ?? 'local'
}

async function evaluate(user: string, tz: string | undefined, client: string): Promise<Outcome> {
  // tz=auto 이거나 생략(빈 값 포함)하면 커밋 시각의 오프셋으로 자동 감지한다
  const timeZone = tz && tz.toLowerCase() !== AUTO_TIME_ZONE ? tz : undefined
  if (!GITHUB_LOGIN.test(user)) return { ok: false, status: 400, message: '올바른 GitHub 아이디가 아니에요.' }
  if (timeZone && !isValidTimeZone(timeZone)) {
    // 아주 긴 값을 그대로 되돌려 보내지 않도록 줄여서 보여 준다
    const shown = timeZone.length > MAX_ECHO_LENGTH ? `${timeZone.slice(0, MAX_ECHO_LENGTH)}…` : timeZone
    return { ok: false, status: 400, message: `알 수 없는 시간대예요: ${shown}` }
  }
  try {
    const stored = await getStored(user, client)
    return { ok: true, result: analyze(stored.activity, timeZone), savedAt: stored.savedAt }
  } catch (error) {
    if (error instanceof GitHubUserNotFoundError) {
      return { ok: false, status: 404, message: `GitHub 사용자 ${user}을(를) 찾을 수 없어요.` }
    }
    if (error instanceof RateLimitedError || error instanceof GitHubRateLimitedError) {
      return { ok: false, status: 429, message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }
    }
    if (error instanceof MissingTokenError) {
      return { ok: false, status: 500, message: '서버에 GITHUB_TOKEN 이 설정되지 않았어요.' }
    }
    console.error(error)
    return { ok: false, status: 500, message: '분석 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' }
  }
}

const app = new Hono()
  .basePath('/api')
  .get('/health', (c) => c.json({ ok: true }))
  .get(
    '/mbti/:user',
    // RPC 클라이언트가 tz 쿼리 타입을 알 수 있도록 validator 로 선언
    validator('query', (value) => ({ tz: typeof value.tz === 'string' ? value.tz : undefined })),
    async (c) => {
      const outcome = await evaluate(c.req.param('user'), c.req.valid('query').tz, clientKey(c))
      if (!outcome.ok) {
        c.header('Cache-Control', errorCacheControl(outcome.status))
        return c.json({ error: outcome.message }, outcome.status)
      }
      // 같은 아이디·시간대 요청은 CDN 이 응답해 함수 실행과 GitHub 조회를 줄인다
      c.header('Cache-Control', resultCacheControl(outcome.savedAt))
      return c.json(outcome.result)
    },
  )
  .get('/card/:user', async (c) => {
    // README에서 `/api/card/minji.svg` 형태로도 쓸 수 있게 확장자 허용
    const user = c.req.param('user').replace(/\.svg$/, '')
    const pending = evaluate(user, c.req.query('tz'), clientKey(c))
    // 시간 안에 못 끝내고 먼저 응답하더라도 조회는 끝까지 마쳐 저장소에 남긴다 (Vercel 이 아니면 아무 일도 하지 않는다)
    waitUntil(pending)
    const outcome = await within(pending, CARD_TIME_BUDGET_MS)
    // layout=compact 는 좁은 화면용 세로 배치. 모르는 값은 무시하고 기본(wide) 배치로 그린다
    const layoutQuery = c.req.query('layout')
    const layout = CARD_LAYOUTS.find((l) => l === layoutQuery) ?? 'wide'
    // theme=dark 는 어두운 화면용 색. 모르는 값은 무시하고 기본(light) 색으로 그린다
    const themeQuery = c.req.query('theme')
    const theme = CARD_THEMES.find((t) => t === themeQuery) ?? 'light'

    c.header('Content-Type', 'image/svg+xml; charset=utf-8')
    c.header('X-Content-Type-Options', 'nosniff')
    // SVG를 직접 열었을 때 스크립트 실행 차단 (방어적 조치)
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
    // 아직 만드는 중이면 안내 카드를 보내고 캐싱하지 않아, 다음 조회 때 완성된 카드를 받게 한다
    if (!outcome) {
      c.header('Cache-Control', NO_STORE)
      return c.body(renderErrorCard(PREPARING_MESSAGE, theme))
    }
    // README(camo)는 200 이 아니면 이미지를 깨진 상태로 보여 주므로, 오류도 200 + 오류 카드로 응답한다
    if (!outcome.ok) {
      c.header('Cache-Control', errorCacheControl(outcome.status))
      return c.body(renderErrorCard(outcome.message, theme))
    }
    if (!outcome.result.measurable) {
      c.header('Cache-Control', ERROR_CACHE_CONTROL)
      return c.body(renderErrorCard(UNMEASURABLE_MESSAGE, theme))
    }
    c.header('Cache-Control', resultCacheControl(outcome.savedAt))
    return c.body(renderCard(outcome.result, layout, theme))
  })

export type AppType = typeof app
export default app
