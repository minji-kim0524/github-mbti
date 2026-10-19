import { hc } from 'hono/client'
import type { AppType } from '../server/app'

// 같은 origin의 /api 로 요청 (로컬은 Vite 프록시가 api 서버로 전달)
export const client = hc<AppType>('/')
