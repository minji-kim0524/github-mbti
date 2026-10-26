import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals'
import type { GitHubActivity } from '../src/server/github.js'
import { calendarOf, commitsAt, makeActivity, repo } from './fixtures.js'

const fetchGitHubActivity = jest.fn<(login: string, token: string) => Promise<GitHubActivity>>()
// github.ts 가 불러오는 @octokit/graphql 은 ESM 전용이라 Jest(CJS)에서 읽을 수 없으므로, app.ts 가 쓰는 것만 대신 만든다
jest.mock('../src/server/github.js', () => ({
  fetchGitHubActivity: (login: string, token: string) => fetchGitHubActivity(login, token),
  GitHubUserNotFoundError: class extends Error {},
}))

// 모킹을 먼저 등록해야 하므로 app 은 mock 뒤에 불러온다
const { default: app } = jest.requireActual<typeof import('../src/server/app.js')>('../src/server/app.js')

const activity = (login: string) =>
  makeActivity({
    login,
    calendar: calendarOf(365, 200),
    repositories: [repo({ owner: login, commitDays: 10 })],
    commitTimestamps: commitsAt(23, 10),
  })

describe('카드 응답 시간 제한', () => {
  beforeAll(() => {
    process.env.GITHUB_TOKEN = 'test-token'
  })

  afterEach(() => {
    jest.useRealTimers()
    fetchGitHubActivity.mockReset()
  })

  test('조회가 3초 안에 끝나면 완성된 카드를 1시간 캐싱한다', async () => {
    fetchGitHubActivity.mockResolvedValue(activity('fast-user'))
    const res = await app.request('/api/card/fast-user')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(await res.text()).toContain('fast-user')
  })

  test('3초가 지나면 안내 카드를 캐싱하지 않고 보내고, 조회는 계속해 다음 요청에 쓴다', async () => {
    jest.useFakeTimers()
    let finish: (value: GitHubActivity) => void = () => {}
    fetchGitHubActivity.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    const pending = app.request('/api/card/slow-user')
    await jest.advanceTimersByTimeAsync(3000)
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
