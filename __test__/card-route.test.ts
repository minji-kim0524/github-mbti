import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals'
import type { GitHubActivity } from '../src/server/github.js'
import { calendarOf, commitsAt, makeActivity, repo } from './fixtures.js'

type App = (typeof import('../src/server/app.js'))['default']

const fetchGitHubActivity = jest.fn<(login: string, token: string) => Promise<GitHubActivity>>()
// github.ts 가 불러오는 @octokit/graphql 은 ESM 전용이라 Jest(CJS)에서 읽을 수 없으므로, app.ts 가 쓰는 것만 대신 만든다
jest.mock('../src/server/github.js', () => ({
  fetchGitHubActivity: (login: string, token: string) => fetchGitHubActivity(login, token),
  GitHubUserNotFoundError: class extends Error {},
}))

// Vercel Runtime Cache 대신 쓰는 저장소. 앱(인스턴스)을 새로 불러와도 남아 있어 배포·인스턴스가 바뀐 상황을 흉내 낸다
const runtimeCache = new Map<string, unknown>()
// waitUntil 로 넘긴 뒤 작업. 테스트에서 끝날 때까지 기다릴 수 있게 모아 둔다
const background: Promise<unknown>[] = []
jest.mock('@vercel/functions', () => ({
  getCache: () => ({
    get: async (key: string) => runtimeCache.get(key) ?? null,
    set: async (key: string, value: unknown) => void runtimeCache.set(key, value),
  }),
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
})

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

describe('Runtime Cache 에 남긴 조회 결과', () => {
  test('새 인스턴스에서도 저장해 둔 결과로 바로 카드를 만들고 GitHub 를 다시 부르지 않는다', async () => {
    fetchGitHubActivity.mockResolvedValue(activity('shared-user'))
    await loadApp().request('/api/card/shared-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)

    const res = await loadApp().request('/api/card/Shared-User')
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(await res.text()).toContain('shared-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)
  })

  test('1시간이 지난 결과는 바로 보여 주고, 새 결과는 뒤에서 받아 저장해 둔다', async () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    runtimeCache.set('stale-user', { savedAt: twoHoursAgo, activity: activity('stale-user') })
    let finish: (value: GitHubActivity) => void = () => {}
    fetchGitHubActivity.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    // GitHub 조회가 끝나지 않았어도 저장해 둔 결과로 바로 완성된 카드를 준다
    const res = await loadApp().request('/api/card/stale-user')
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(await res.text()).toContain('stale-user')
    expect(fetchGitHubActivity).toHaveBeenCalledTimes(1)

    finish(activity('stale-user'))
    await Promise.all(background)
    const saved = runtimeCache.get('stale-user') as { savedAt: number }
    expect(saved.savedAt).toBeGreaterThan(twoHoursAgo)
  })
})
