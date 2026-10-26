// TypeScript 7 은 ts-jest 가 쓰는 JS API 가 없어서, 타입 검사 없이 빠르게 변환하는 SWC 를 쓴다 (타입 검사는 pnpm typecheck)
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__test__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': '@swc/jest',
  },
  // 소스는 ESM 규칙대로 './analyze.js' 처럼 import 하므로, 테스트에서는 .ts 파일로 이어 준다
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
