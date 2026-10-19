// 로컬 개발용: 루트의 .env 가 있으면 process.env 로 로드 (배포 환경은 플랫폼 환경변수 사용)
try {
  process.loadEnvFile()
} catch {
  // .env 가 없으면 무시
}
