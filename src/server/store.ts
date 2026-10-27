import { Redis } from '@upstash/redis'
import type { GitHubActivity } from './github.js'

// 조회 결과를 아이디별로 계속 보관하는 저장소. README 에 붙인 카드는 오래 조회되지 않아도 지워지면 안 되므로 만료 시간을 두지 않는다.
// 배포 환경은 Upstash Redis(Vercel Marketplace 연결, KV_REST_API_URL·KV_REST_API_TOKEN)를 쓰고, 로컬·프리뷰처럼 연결이 없으면 메모리로 대신한다.

export type StoredActivity = { savedAt: number; activity: GitHubActivity }

export type ActivityStore = {
  get(key: string): Promise<StoredActivity | undefined>
  set(key: string, value: StoredActivity): Promise<void>
  /** 같은 아이디를 여러 인스턴스가 동시에 GitHub 에서 새로 받지 않도록 잠깐 맡는다. 맡았으면 true */
  claimRefresh(key: string, seconds: number): Promise<boolean>
}

/** Redis 한 번의 요청을 기다리는 최대 시간. 카드 응답 제한(1.5초) 안에 끝나야 한다 */
const REDIS_TIMEOUT_MS = 700

function redisStore(redis: Redis): ActivityStore {
  return {
    async get(key) {
      return (await redis.get<StoredActivity>(`activity:${key}`)) ?? undefined
    },
    async set(key, value) {
      await redis.set(`activity:${key}`, value)
    },
    async claimRefresh(key, seconds) {
      return (await redis.set(`refresh:${key}`, 1, { nx: true, ex: seconds })) === 'OK'
    },
  }
}

function memoryStore(): ActivityStore {
  const values = new Map<string, StoredActivity>()
  const claims = new Map<string, number>()
  return {
    async get(key) {
      return values.get(key)
    },
    async set(key, value) {
      values.set(key, value)
    },
    async claimRefresh(key, seconds) {
      const now = Date.now()
      if ((claims.get(key) ?? 0) > now) return false
      claims.set(key, now + seconds * 1000)
      return true
    },
  }
}

export function createActivityStore(): ActivityStore {
  const { KV_REST_API_URL: url, KV_REST_API_TOKEN: token } = process.env
  if (!url || !token) return memoryStore()
  return redisStore(
    new Redis({
      url,
      token,
      // 기본값(5번, 지수 대기)은 카드 응답 제한을 넘기므로 한 번만 다시 시도한다
      retry: { retries: 1, backoff: () => 50 },
      signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
      enableTelemetry: false,
    }),
  )
}
