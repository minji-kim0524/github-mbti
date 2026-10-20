import app from '../src/server/app.js'

// Vercel Function 진입점. vercel.json 에서 /api/* 요청을 모두 이 함수로 보낸다.
// 원래 경로(/api/card/...)는 그대로 전달되므로 app 의 basePath('/api') 라우트가 그대로 동작한다.
export default app
