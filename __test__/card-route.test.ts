import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals'
import type { GitHubActivity, GitHubRateLimit } from '../src/server/github.js'
import type { StoredActivity } from '../src/server/store.js'
import { calendarOf, commitsAt, makeActivity, repo } from './fixtures.js'

type App = (typeof import('../src/server/app.js'))['default']

type OnRateLimit = (rateLimit: GitHubRateLimit) => void
const fetchGitHubActivity =
  jest.fn<(login: string, token: string, onRateLimit?: OnRateLimit) => Promise<GitHubActivity>>()
// 테스트에서 던진 오류를 app.ts 가 instanceof 로 알아보도록 같은 클래스를 쓴다
class MockGitHubRateLimitedError extends Error {}
// github.ts 가 불러오는 @octokit/graphql 은 ESM 전용이라 Jest(CJS)에서 읽을 수 없으므로, app.ts 가 쓰는 것만 대신 만든다
jest.mock('../src/server/github.js', () => ({
  fetchGitHubActivity: (login: string, token: string, onRateLimit?: OnRateLimit) =>
    fetchGitHubActivity(login, token, onRateLimit),
  GitHubUserNotFoundError: class extends Error {},
  GitHubRateLimitedError: MockGitHubRateLimitedError,
}))

// Upstash Redis 대신 쓰는 저장소. 앱(인스턴스)을 새로 불러와도 남아 있어 배포·인스턴스가 바뀐 상황을 흉내 낸다
const saved = new Map<string, StoredActivity>()
// 다른 인스턴스가 새로 받는 중인 아이디 (claimRefresh 가 false 를 돌려준다)
const claimedElsewhere = new Set<string>()
let storeFails = false
jest.mock('../src/server/store.js', () => ({
  createActivityStore: () => ({
    get: async (key: string) => {
      if (storeFails) throw new Error('저장소 장애')
      return saved.get(key)
    },
    set: async (key: string, value: StoredActivity) => {
      if (storeFails) throw new Error('저장소 장애')
      saved.set(key, value)
    },
    claimRefresh: async (key: string) => !claimedElsewhere.has(key),
  }),
}))
// waitUntil 로 넘긴 뒤 작업. 테스트에서 끝날 때까지 기다릴 수 있게 모아 둔다
const background: Promise<unknown>[] = []
jest.mock('@vercel/functions', () => ({
  waitUntil: (promise: Promise<unknown>) => void background.push(promise),
}))

/** 메모리 캐시가 빈 새 인스턴스처럼 app 을 새로 불러온다 */
function loadApp(): App {
  let app: App | undefined
  jest.isolateModules(() => {
    app = jest.requireActual<{ default: App }>('../src/server/app.js').default
  })
  return app!
}

const activity = (login: string) =>
  makeActivity({
    login,
    calendar: calendarOf(365, 200),
    repositories: [repo({ owner: login, commitDays: 10 })],
    commitTimestamps: commitsAt(23, 10),
  })

beforeAll(() => {
  process.env.GITHUB_TOKEN = 'test-token'
})

afterEach(() => {
  jest.useRealTimers()
  fetchGitHubActivity.mockReset()
  claimedElsewhere.clear()
  storeFails = false
})

const HOUR = 60 * 60 * 1000
const maxAge = (res: Response) => Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1])

describe('카드 응답 시간 제한', () => {
  const app = loadApp()

  test('조회가 1.5초 안에 끝나면 완성된 카드를 1시간 캐싱한다', async () => {
    fetchGitHubActivity.mockResolvedValue(activity('fast-user'))
    const res = await app.request('/api/card/fast-user')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(await res.text()).toContain('fast-user')
  })

  test('1.5초가 지나면 안내 카드를 캐싱하지 않고 보내고, 조회는 계속해 다음 요청에 쓴다', async () => {
    jest.useFakeTimers()
    let finish: (value: GitHubActivity) => void = () => {}
    fetchGitHubActivity.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    const pending = app.request('/api/card/slow-user')
    await jest.advanceTimersByTimeAsync(1500)
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toContain('카드를 만드는 중이에요')

    finish(activity('slow-user'))
    const next = await app.request('/api/card/slow-user')
    expect(next.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(await next.text()).toContain('slow-user')
    // 두 번째 요청은 메모리 캐시의 같은 조회를 써서 GitHub 를 다시 부르지 않는다
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)
  })
})

describe('저장소에 남긴 조회 결과', () => {
  test('새 인스턴스에서도 저장해 둔 결과로 바로 카드를 만들고 GitHub 를 다시 부르지 않는다', async () => {
    fetchGitHubActivity.mockResolvedValue(activity('shared-user'))
    await loadApp().request('/api/card/shared-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)

    const res = await loadApp().request('/api/card/Shared-User')
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(await res.text()).toContain('shared-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)
  })

  test('오래 조회되지 않은 결과도 지우지 않고 기존 카드로 바로 보여 주며, 새 결과는 뒤에서 받아 바꾼다', async () => {
    const monthAgo = Date.now() - 30 * 24 * HOUR
    saved.set('stale-user', { savedAt: monthAgo, activity: activity('stale-user') })
    let finish: (value: GitHubActivity) => void = () => {}
    fetchGitHubActivity.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    // GitHub 조회가 끝나지 않았어도 기존 카드를 바로 주고, 곧 새 카드로 바뀌도록 1분만 캐싱한다
    const app = loadApp()
    const res = await app.request('/api/card/stale-user')
    expect(maxAge(res)).toBe(60)
    expect(await res.text()).toContain('stale-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)

    finish(activity('stale-user'))
    await Promise.all(background)
    expect(saved.get('stale-user')!.savedAt).toBeGreaterThan(monthAgo)
    // 새 결과를 받은 뒤에는 다시 1시간 캐싱한다
    const next = await app.request('/api/card/stale-user')
    expect(maxAge(next)).toBe(3600)
  })

  test('최신 결과는 1시간이 되는 시점까지만 캐싱한다', async () => {
    saved.set('aging-user', { savedAt: Date.now() - 40 * 60 * 1000, activity: activity('aging-user') })
    const res = await loadApp().request('/api/card/aging-user')
    expect(maxAge(res)).toBeGreaterThan(1190)
    expect(maxAge(res)).toBeLessThanOrEqual(1200)
    expect(fetchGitHubActivity).not.toHaveBeenCalled()
  })

  test('새 결과를 받지 못해도 기존 카드를 계속 보여 준다', async () => {
    saved.set('fail-user', { savedAt: Date.now() - 2 * HOUR, activity: activity('fail-user') })
    fetchGitHubActivity.mockRejectedValue(new Error('GitHub 오류'))
    const app = loadApp()
    await app.request('/api/card/fail-user')
    await Promise.all(background)

    const res = await app.request('/api/card/fail-user')
    expect(await res.text()).toContain('fail-user')
    expect(res.headers.get('Cache-Control')).not.toBe('no-store')
  })

  test('저장소에 문제가 생겨도 메모리에 있는 기존 카드를 보여 준다', async () => {
    fetchGitHubActivity.mockResolvedValue(activity('memory-user'))
    const app = loadApp()
    await app.request('/api/card/memory-user')

    storeFails = true
    const res = await app.request('/api/card/memory-user')
    expect(await res.text()).toContain('memory-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)
  })

  test('메모리의 결과가 1시간이 지났고 저장소와 GitHub 가 모두 실패해도 기존 카드를 보여 준다', async () => {
    fetchGitHubActivity.mockResolvedValue(activity('outage-user'))
    const app = loadApp()
    await app.request('/api/card/outage-user')

    // 시계만 2시간 앞으로 돌린다 (응답 제한 타이머는 실제 시간으로 둔다)
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] })
    jest.setSystemTime(Date.now() + 2 * HOUR)
    storeFails = true
    fetchGitHubActivity.mockRejectedValue(new Error('GitHub 오류'))
    const res = await app.request('/api/card/outage-user')
    expect(await res.text()).toContain('outage-user')
    expect(maxAge(res)).toBe(60)
    await Promise.all(background)
  })

  test('다른 인스턴스가 새로 받는 중이면 GitHub 를 부르지 않고, 1분 안의 반복 요청도 한 번만 확인한다', async () => {
    saved.set('busy-user', { savedAt: Date.now() - 2 * HOUR, activity: activity('busy-user') })
    claimedElsewhere.add('busy-user')
    const app = loadApp()
    for (let i = 0; i < 3; i += 1) await app.request('/api/card/busy-user')
    await Promise.all(background)
    expect(fetchGitHubActivity).not.toHaveBeenCalled()
  })
})

describe('GitHub 토큰 남은 포인트 기준 조회 중단', () => {
  const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  /** 조회할 때 GitHub 가 남은 포인트를 remaining 으로 알려 준 것처럼 응답한다 */
  const respondWith = (remaining: number, resetAt = inAnHour) =>
    fetchGitHubActivity.mockImplementation(async (login, _token, onRateLimit) => {
      onRateLimit?.({ remaining, resetAt })
      return activity(login)
    })

  test('남은 포인트가 기준 이하이면 새 아이디는 조회하지 않고, 저장해 둔 아이디는 그대로 보여 준다', async () => {
    const app = loadApp()
    saved.set('kept-user', { savedAt: Date.now(), activity: activity('kept-user') })
    respondWith(500)
    await app.request('/api/card/first-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)

    const blocked = await app.request('/api/card/second-user')
    expect(blocked.headers.get('Cache-Control')).toBe('no-store')
    expect(await blocked.text()).toContain('요청이 너무 많아요')
    const json = await app.request('/api/mbti/second-user')
    expect(json.status).toBe(429)
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)

    const kept = await app.request('/api/card/kept-user')
    expect(kept.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(await kept.text()).toContain('kept-user')
  })

  test('포인트가 다시 채워질 시각이 지나면 새 조회를 다시 한다', async () => {
    const app = loadApp()
    respondWith(10, new Date(Date.now() - 1000).toISOString())
    await app.request('/api/card/reset-first')
    const res = await app.request('/api/card/reset-second')
    expect(await res.text()).toContain('reset-second')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(2)
  })

  test('남은 포인트가 아주 적으면 1시간이 지난 결과도 새로 받지 않고 그대로 쓴다', async () => {
    const app = loadApp()
    respondWith(100)
    await app.request('/api/card/budget-user')
    saved.set('old-user', { savedAt: Date.now() - 2 * HOUR, activity: activity('old-user') })

    const res = await app.request('/api/card/old-user')
    expect(await res.text()).toContain('old-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)
  })

  test('GitHub 가 한도 초과로 거절하면 안내 카드를 보내고, 한동안 새 조회를 멈춘다', async () => {
    const app = loadApp()
    fetchGitHubActivity.mockRejectedValue(new MockGitHubRateLimitedError())
    const res = await app.request('/api/card/limited-user')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toContain('요청이 너무 많아요')

    fetchGitHubActivity.mockReset()
    respondWith(4000)
    await app.request('/api/card/after-limit')
    expect(fetchGitHubActivity).not.toHaveBeenCalled()
  })
})
