import type { GitHubActivity } from '../src/server/github.js'

/** 판정에 영향이 없는 기본값으로 채운 활동 데이터. 테스트마다 필요한 값만 덮어쓴다 */
export function makeActivity(overrides: Partial<GitHubActivity> = {}): GitHubActivity {
  return {
    login: 'octocat',
    name: null,
    from: '2025-10-26T00:00:00Z',
    to: '2026-10-26T00:00:00Z',
    totals: { commits: 0, pullRequests: 0, teamPullRequests: 0, reviews: 0, issues: 0, restricted: 0 },
    calendar: [],
    repositories: [],
    commitTimestamps: [],
    ...overrides,
  }
}

/** 시(hour)별 커밋 시각. 오프셋을 유지하는 GitTimestamp 형식으로 만든다 */
export function commitsAt(hour: number, count: number, offset = '+09:00'): string[] {
  const time = `2026-10-20T${String(hour).padStart(2, '0')}:30:00${offset}`
  return Array.from({ length: count }, () => time)
}

/** 전체 days 일 중 앞의 active 일만 기여한 잔디 */
export function calendarOf(days: number, active: number): GitHubActivity['calendar'] {
  return Array.from({ length: days }, (_, i) => ({ date: `day-${i}`, count: i < active ? 1 : 0 }))
}

type Repo = GitHubActivity['repositories'][number]

export function repo(overrides: Partial<Repo>): Repo {
  return { owner: 'octocat', name: 'repo', isFork: false, language: 'TypeScript', commitDays: 1, ...overrides }
}
