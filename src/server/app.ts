import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { analyze, DEFAULT_TIME_ZONE, isValidTimeZone } from './analyze.js'
import { renderCard, renderErrorCard } from './card.js'
import { fetchGitHubActivity, GitHubUserNotFoundError, type GitHubActivity } from './github.js'

// GitHub username 규칙: 영숫자와 하이픈, 최대 39자, 하이픈으로 시작 불가
const GITHUB_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/

/** GitHub API 결과 캐시 기간. MBTI 는 자주 바뀌지 않으므로 길게 잡아 rate limit 을 아낀다. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const CARD_CACHE_CONTROL = 'public, max-age=43200, s-maxage=86400, stale-while-revalidate=3600'
const ERROR_CACHE_CONTROL = 'public, max-age=300'

// 서버 메모리 캐시 (login 소문자 → 조회 결과). 같은 사용자의 동시 요청은 하나의 Promise 를 공유한다.
class MissingTokenError extends Error {}

const activityCache = new Map<string, { expiresAt: number; promise: Promise<GitHubActivity> }>()

function getActivity(login: string): Promise<GitHubActivity> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new MissingTokenError()

  const key = login.toLowerCase()
  const cached = activityCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = fetchGitHubActivity(login, token)
  activityCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, promise })
  // 실패한 결과는 캐시하지 않는다
  promise.catch(() => activityCache.delete(key))
  return promise
}

type Outcome =
  | { ok: true; result: ReturnType<typeof analyze> }
  | { ok: false; status: 400 | 404 | 500; message: string }

async function evaluate(user: string, tz: string | undefined): Promise<Outcome> {
  const timeZone = tz || DEFAULT_TIME_ZONE
  if (!GITHUB_LOGIN.test(user)) return { ok: false, status: 400, message: '올바른 GitHub 아이디가 아니에요.' }
  if (!isValidTimeZone(timeZone)) return { ok: false, status: 400, message: `알 수 없는 시간대예요: ${timeZone}` }
  try {
    return { ok: true, result: analyze(await getActivity(user), timeZone) }
  } catch (error) {
    if (error instanceof GitHubUserNotFoundError) {
      return { ok: false, status: 404, message: `GitHub 사용자 ${user}을(를) 찾을 수 없어요.` }
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
      const outcome = await evaluate(c.req.param('user'), c.req.valid('query').tz)
      if (!outcome.ok) return c.json({ error: outcome.message }, outcome.status)
      return c.json(outcome.result)
    },
  )
  .get('/card/:user', async (c) => {
    // README에서 `/api/card/minji.svg` 형태로도 쓸 수 있게 확장자 허용
    const user = c.req.param('user').replace(/\.svg$/, '')
    const outcome = await evaluate(user, c.req.query('tz'))

    c.header('Content-Type', 'image/svg+xml; charset=utf-8')
    c.header('X-Content-Type-Options', 'nosniff')
    // SVG를 직접 열었을 때 스크립트 실행 차단 (방어적 조치)
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
    // README(camo)는 200 이 아니면 이미지를 깨진 상태로 보여 주므로, 오류도 200 + 오류 카드로 응답한다
    if (!outcome.ok) {
      c.header('Cache-Control', ERROR_CACHE_CONTROL)
      return c.body(renderErrorCard(outcome.message))
    }
    c.header('Cache-Control', CARD_CACHE_CONTROL)
    return c.body(renderCard(outcome.result))
  })

export type AppType = typeof app
export default app
