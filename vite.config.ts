import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 로컬에서는 /api 요청을 Hono 서버로 넘긴다
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
