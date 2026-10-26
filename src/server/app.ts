import { getCache, waitUntil } from '@vercel/functions'
import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import { analyze, isValidTimeZone } from './analyze.js'
import { CARD_LAYOUTS, CARD_THEMES, renderCard, renderErrorCard } from './card.js'
import { fetchGitHubActivity, GitHubUserNotFoundError, type GitHubActivity } from './github.js'

// GitHub username 규칙: 영숫자와 하이픈, 최대 39자, 하이픈으로 시작 불가
const GITHUB_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/

/** GitHub API 결과 캐시 기간. 새 커밋이 1시간 안에 반영되게 하면서 rate limit 을 아낀다. */
const CACHE_TTL_MS = 60 * 60 * 1000
/**
 * Vercel Runtime Cache 에 조회 결과를 남겨 두는 기간(초). 배포·인스턴스가 바뀌어도 남아 있어,
 * 1시간이 지난 결과도 일단 바로 보여 주고 새 결과는 뒤에서 받아 바꿔 둔다. 오래 조회되지 않은 아이디만 지워진다
 */
const STORED_TTL_S = 7 * 24 * 60 * 60
/** 1시간이 지난 결과를 돌려준 뒤, 뒤에서 새로 받은 결과를 다시 읽기까지 메모리에 두는 시간 */
const STALE_RECHECK_MS = 60 * 1000
// 1시간 동안은 캐시를 그대로 쓰고, 그 뒤 하루 동안은 이전 카드를 바로 보여 주면서 뒤에서 새로 만든다
const CARD_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
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
/** 메모리 캐시·요청 제한 기록이 끝없이 늘지 않도록 두는 최대 항목 수 */
const MAX_CACHED_USERS = 1000
const MAX_TRACKED_CLIENTS = 5000
/** 오류 메시지에 되돌려 보여 줄 tz 의 최대 길이 */
const MAX_ECHO_LENGTH = 40

const UNMEASURABLE_MESSAGE = '최근 1년 공개 활동이 없어 MBTI를 측정할 수 없어요.'

/**
 * 카드 응답을 기다리는 최대 시간. GitHub 이미지 프록시(camo)는 약 4.2초 안에 응답이 끝나지 않으면 이미지를 깨뜨리고,
 * 헤더만 도착하고 본문이 잘리면 빈 이미지를 그대로 캐싱한다. 콜드 스타트(실측 1초 이상)·네트워크 시간을 빼고 여유를 두어 2초로 잡는다
 */
const CARD_TIME_BUDGET_MS = 2000
const PREPARING_MESSAGE = '카드를 만드는 중이에요. 잠시 후 새로고침해 주세요.'

/** 시간대를 커밋 시각으로 자동 감지하라는 tz 값 */
const AUTO_TIME_ZONE = 'auto'

class MissingTokenError extends Error {}
class RateLimitedError extends Error {}

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

type StoredActivity = { savedAt: number; activity: GitHubActivity }

// 인스턴스·배포가 달라도 함께 쓰는 조회 결과 저장소 (login 소문자 → 조회 결과와 시각). 로컬에서는 메모리로 대신한다
const store = getCache({ namespace: 'activity' })

async function readStored(key: string): Promise<StoredActivity | undefined> {
  try {
    return ((await store.get(key)) as StoredActivity | null) ?? undefined
  } catch (error) {
    // 저장소를 못 읽으면 GitHub 에서 새로 조회한다
    console.error(error)
    return undefined
  }
}

async function fetchAndStore(login: string, key: string, token: string): Promise<StoredActivity> {
  const stored = { savedAt: Date.now(), activity: await fetchGitHubActivity(login, token) }
  // 저장에 실패해도 이번 조회 결과는 그대로 쓴다
  await store.set(key, stored, { ttl: STORED_TTL_S, name: 'github-activity' }).catch(console.error)
  return stored
}

async function loadActivity(login: string, key: string, token: string, client: string): Promise<StoredActivity> {
  const stored = await readStored(key)
  if (stored) {
    // 1시간이 지난 결과는 일단 그대로 쓰고, 새 결과는 응답과 상관없이 뒤에서 받아 저장해 둔다
    if (Date.now() - stored.savedAt > CACHE_TTL_MS) {
      waitUntil(fetchAndStore(login, key, token).catch(console.error))
    }
    return stored
  }
  if (!consumeLookup(client)) throw new RateLimitedError()
  return fetchAndStore(login, key, token)
}

// 서버 메모리 캐시 (login 소문자 → 조회 결과). 같은 사용자의 동시 요청은 하나의 Promise 를 공유한다.
const activityCache = new Map<string, { expiresAt: number; promise: Promise<GitHubActivity> }>()

function getActivity(login: string, client: string): Promise<GitHubActivity> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new MissingTokenError()

  const key = login.toLowerCase()
  const cached = activityCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const loaded = loadActivity(login, key, token, client)
  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, promise: loaded.then((stored) => stored.activity) }
  // 만료된 항목을 덮어쓰면 예전 순서가 유지돼 정리 때 가장 먼저 지워지므로, 지운 뒤 맨 뒤에 다시 넣는다
  activityCache.delete(key)
  activityCache.set(key, entry)
  prune(activityCache, MAX_CACHED_USERS, (e) => e.expiresAt <= Date.now())
  loaded.then(
    // 저장해 둔 지 1시간이 지난 결과였다면, 뒤에서 새로 받은 결과를 곧 다시 읽도록 메모리에는 잠깐만 둔다
    (stored) => (entry.expiresAt = Math.max(stored.savedAt + CACHE_TTL_MS, Date.now() + STALE_RECHECK_MS)),
    // 실패한 결과는 캐시하지 않는다
    () => activityCache.delete(key),
  )
  return entry.promise
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
  { ok: true; result: ReturnType<typeof analyze> } | { ok: false; status: 400 | 404 | 429 | 500; message: string }

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
    return { ok: true, result: analyze(await getActivity(user, client), timeZone) }
  } catch (error) {
    if (error instanceof GitHubUserNotFoundError) {
      return { ok: false, status: 404, message: `GitHub 사용자 ${user}을(를) 찾을 수 없어요.` }
    }
    if (error instanceof RateLimitedError) {
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
      c.header('Cache-Control', CARD_CACHE_CONTROL)
      return c.json(outcome.result)
    },
  )
  .get('/card/:user', async (c) => {
    // README에서 `/api/card/minji.svg` 형태로도 쓸 수 있게 확장자 허용
    const user = c.req.param('user').replace(/\.svg$/, '')
    const pending = evaluate(user, c.req.query('tz'), clientKey(c))
    // 시간 안에 못 끝내고 먼저 응답하더라도 조회는 끝까지 마쳐 메모리 캐시에 남긴다 (Vercel 이 아니면 아무 일도 하지 않는다)
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
    c.header('Cache-Control', CARD_CACHE_CONTROL)
    return c.body(renderCard(outcome.result, layout, theme))
  })

export type AppType = typeof app
export default app
