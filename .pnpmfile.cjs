// typescript-eslint 는 TypeScript 의 JS API 를 쓰는데, 이 프로젝트의 typescript 7 은 네이티브 컴파일러라 JS API 가 없다.
// 그래서 typescript-eslint 관련 패키지만 JS API 가 있는 TypeScript 6 호환 패키지를 쓰도록 바꾼다.
// (프로젝트의 타입 검사·빌드는 계속 typescript 7 을 쓴다)
const TS_API = 'npm:@typescript/typescript6@^6.0.2'

function needsTsApi(name) {
  return name === 'typescript-eslint' || name.startsWith('@typescript-eslint/') || name === 'ts-api-utils'
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (needsTsApi(pkg.name) && pkg.peerDependencies?.typescript) {
        delete pkg.peerDependencies.typescript
        pkg.dependencies = { ...pkg.dependencies, typescript: TS_API }
      }
      return pkg
    },
  },
}
