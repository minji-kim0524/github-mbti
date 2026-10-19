// GITHUB_TOKEN 을 읽기 전에 .env 를 먼저 로드한다
import './env.js'
import { serve } from '@hono/node-server'
import app from './app.js'

const port = Number(process.env.PORT ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api: http://localhost:${info.port}`)
})
