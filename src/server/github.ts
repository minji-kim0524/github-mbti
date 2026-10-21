import { graphql } from '@octokit/graphql'

// GitHub GraphQL 조회. 사용자 1명당 쿼리 2번(약 7포인트)으로 끝나도록 필드를 최소화한다.

/** 커밋 시각을 조회할 상위 저장소 수 (저장소당 최대 100커밋) */
const HISTORY_REPO_LIMIT = 5

export type GitHubActivity = {
  login: string
  name: string | null
  avatarUrl: string
  from: string
  to: string
  totals: {
    commits: number
    pullRequests: number
    /** 내 소유가 아닌 저장소(팀 저장소)에 낸 PR 수. 내 저장소에 혼자 낸 PR 은 협업 근거에서 뺀다 */
    teamPullRequests: number
    reviews: number
    issues: number
    /** 비공개 저장소 기여 수 (상세는 볼 수 없음) */
    restricted: number
  }
  /** 날짜별 기여 수 (잔디) */
  calendar: { date: string; count: number }[]
  /** 저장소별 커밋한 날 수 */
  repositories: { owner: string; name: string; isFork: boolean; language: string | null; commitDays: number }[]
  /** 커밋 작성 시각 (GitTimestamp: UTC 로 변환되지 않은 ISO-8601 문자열) */
  commitTimestamps: string[]
}

export class GitHubUserNotFoundError extends Error {}

type ContributionsResponse = {
  user: {
    id: string
    login: string
    name: string | null
    avatarUrl: string
    contributionsCollection: {
      totalCommitContributions: number
      totalPullRequestContributions: number
      totalPullRequestReviewContributions: number
      totalIssueContributions: number
      restrictedContributionsCount: number
      contributionCalendar: {
        weeks: { contributionDays: { date: string; contributionCount: number }[] }[]
      }
      commitContributionsByRepository: {
        contributions: { totalCount: number }
        repository: { name: string; isFork: boolean; owner: { login: string }; primaryLanguage: { name: string } | null }
      }[]
      pullRequestContributionsByRepository: {
        contributions: { totalCount: number }
        repository: { owner: { login: string } }
      }[]
    }
  } | null
}

const CONTRIBUTIONS_QUERY = /* GraphQL */ `
  query Contributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      id
      login
      name
      avatarUrl
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
        restrictedContributionsCount
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
        commitContributionsByRepository(maxRepositories: 25) {
          contributions(first: 1) {
            totalCount
          }
          repository {
            name
            isFork
            owner {
              login
            }
            primaryLanguage {
              name
            }
          }
        }
        pullRequestContributionsByRepository(maxRepositories: 25) {
          contributions(first: 1) {
            totalCount
          }
          repository {
            owner {
              login
            }
          }
        }
      }
    }
  }
`

type HistoryResponse = Record<
  string,
  { defaultBranchRef: { target: { history?: { nodes: { author: { date: string | null } | null }[] } } } | null } | null
>

/** 상위 저장소들의 커밋 이력을 별칭(r0, r1, ...)으로 한 번에 조회하는 쿼리 생성. 저장소 이름은 변수로만 전달한다. */
function buildHistoryQuery(count: number): string {
  const params = Array.from({ length: count }, (_, i) => `$o${i}: String!, $n${i}: String!`).join(', ')
  const fields = Array.from(
    { length: count },
    (_, i) => `
    r${i}: repository(owner: $o${i}, name: $n${i}) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: 100, author: { id: $authorId }, since: $since) {
              nodes {
                author {
                  date
                }
              }
            }
          }
        }
      }
    }`,
  ).join('')
  return `query History($authorId: ID!, $since: GitTimestamp!, ${params}) {${fields}\n}`
}

export async function fetchGitHubActivity(login: string, token: string): Promise<GitHubActivity> {
  const client = graphql.defaults({ headers: { authorization: `token ${token}` } })

  const to = new Date()
  const from = new Date(to)
  from.setFullYear(from.getFullYear() - 1)

  const { user } = await client<ContributionsResponse>(CONTRIBUTIONS_QUERY, {
    login,
    from: from.toISOString(),
    to: to.toISOString(),
  })
  if (!user) throw new GitHubUserNotFoundError(login)

  const collection = user.contributionsCollection
  const repositories = collection.commitContributionsByRepository.map((item) => ({
    owner: item.repository.owner.login,
    name: item.repository.name,
    isFork: item.repository.isFork,
    language: item.repository.primaryLanguage?.name ?? null,
    commitDays: item.contributions.totalCount,
  }))

  const topRepos = [...repositories].sort((a, b) => b.commitDays - a.commitDays).slice(0, HISTORY_REPO_LIMIT)
  const commitTimestamps: string[] = []
  if (topRepos.length > 0) {
    const variables: Record<string, string> = { authorId: user.id, since: from.toISOString() }
    topRepos.forEach((repo, i) => {
      variables[`o${i}`] = repo.owner
      variables[`n${i}`] = repo.name
    })
    const history = await client<HistoryResponse>(buildHistoryQuery(topRepos.length), variables)
    for (const repo of Object.values(history)) {
      for (const node of repo?.defaultBranchRef?.target.history?.nodes ?? []) {
        if (node.author?.date) commitTimestamps.push(node.author.date)
      }
    }
  }

  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      commits: collection.totalCommitContributions,
      pullRequests: collection.totalPullRequestContributions,
      teamPullRequests: collection.pullRequestContributionsByRepository
        .filter((item) => item.repository.owner.login.toLowerCase() !== user.login.toLowerCase())
        .reduce((sum, item) => sum + item.contributions.totalCount, 0),
      reviews: collection.totalPullRequestReviewContributions,
      issues: collection.totalIssueContributions,
      restricted: collection.restrictedContributionsCount,
    },
    calendar: collection.contributionCalendar.weeks.flatMap((week) =>
      week.contributionDays.map((day) => ({ date: day.date, count: day.contributionCount })),
    ),
    repositories,
    commitTimestamps,
  }
}
