# 깃허브 MBTI

> 내 깃허브의 MBTI는 무엇일까? (*커밋 내역을 기반으로 측정됩니다.)

GitHub 공개 활동(커밋 시각·잔디·언어·협업)을 분석해 4글자 개발자 유형을 SVG 카드로 보여 주는 서비스.
**읽기 전용 + 무상태 + SVG 렌더링** 구조라 DB·로그인이 없다.
모든 응답·주석·문서는 한국어로 작성한다 (코드 식별자·기술 용어는 원문 유지).

## 동작 방식

GitHub 프로필 README는 JS를 실행하지 않으므로, github-readme-stats처럼 **서버가 동적 SVG 카드를 생성**한다.

```md
[![깃허브 MBTI](https://github-mbti-whoami.vercel.app/api/card/{githubID})](https://github-mbti-whoami.vercel.app)
```

- `GET /api/card/:user?tz=&layout=&theme=` → MBTI 카드 SVG. `layout=compact` 는 좁은 화면용 세로 배치(360px), 생략하면 가로 배치(600px). 웹 미리보기는 599px 이하 화면에서 compact 를 쓴다
- `theme=dark` 는 어두운 카드, 생략하면 연한 배경의 라이트 카드. README 스니펫은 마크다운 한 줄(라이트 카드)이고, GitHub 테마에 맞추려면 `<picture>` + `prefers-color-scheme` 을 쓴다 (README 에 안내)
- `tz=auto` 또는 생략 시 커밋 시각(`author.date`)의 오프셋으로 시간대를 **자동 감지**한다. 지정하면 그 IANA 시간대로 변환해 판정한다. 커밋 시각 데이터가 없으면 `Asia/Seoul`.
- `GET /api/mbti/:user?tz=` → 판정 결과 JSON (웹 랜딩에서 사용)

## MBTI 4축 (이름 확정 — 기준값은 조정 중)

| 축 | 글자 | 기준 | GraphQL 데이터 |
| --- | --- | --- | --- |
| 시간 | N 새벽커밋형 / D 오전배포형 | 시간당 커밋 수(밀도)로 환산한 20~05시 비율 ≥ 50% → N. 새벽 9시간·낮 15시간으로 구간 길이가 달라 커밋 수를 구간 길이로 나눠 비교한다 (자동 감지면 커밋별 현지 시각, `tz` 지정 시 그 시간대 기준) | 상위 5개 저장소 `history(author: {id})` 의 `author.date` (GitTimestamp, UTC 미변환) |
| 리듬 | S 성실한 농부형 / R 몰아치는 파도형 | 1년 중 기여한 날 비율 ≥ 50% → S | `contributionCalendar` |
| 범위 | F 원툴장인형 / M 멀티언어형 | 커밋한 날 수로 가중한 최다 언어 비율 ≥ 60% → F | `commitContributionsByRepository` 의 `primaryLanguage` |
| 협업 | A 솔로 플레이어형 / T 팀 플레이어형 | 팀 활동 비율 ≥ 50% → T. 팀 활동 = 팀 저장소(내 소유가 아닌 저장소) 커밋한 날 + 팀 저장소 PR + 리뷰, 솔로 활동 = 내 저장소 커밋한 날 (한 건씩 세고, 내 저장소 PR 은 제외) | 저장소 `owner`, `pullRequestContributionsByRepository`, `totalPullRequestReviewContributions` |

참고 (실제 응답으로 확인함):
- `commitContributionsByRepository[].contributions.totalCount` 는 커밋 수가 아니라 **커밋한 날 수**다.
- 커밋 시각 `author.date`(GitTimestamp)는 작성자의 시간대 오프셋을 유지한다 (예: `2026-10-18T13:14:58-10:00`).
- Fine-grained token(Public repositories 읽기 전용, 권한 없음)으로 모든 쿼리가 동작한다.

## 기술 스택

Next.js·모노레포는 쓰지 않는다 (SSR 이점이 없고, 패키지 하나로 충분).

| 영역 | 선택 |
| --- | --- |
| 프론트 | Vite + React + TypeScript (`src/web`) |
| 백엔드 | Hono (`src/server`, 로컬은 `@hono/node-server`) |
| GitHub API | `@octokit/graphql` (서버 토큰 `GITHUB_TOKEN`) |
| 타입 공유 | Hono RPC (`hono/client` + `AppType`) |
| 폰트 | Pretendard (웹). SVG 카드는 웹폰트를 못 쓰므로 시스템 폰트로 대체 |
| 배포 | Vercel — Vite 정적 빌드(`dist`) + Vercel Function(`api/index.ts`) |

## 구조

```
index.html, vite.config.ts   Vite 진입점 (dev 서버가 /api 를 8787 로 프록시)
vercel.json    Vercel 설정 (/api/* → api/index.ts 로 rewrite)
api/index.ts   Vercel Function 진입점 (src/server/app.ts 를 default export)
src/web/       랜딩: README 스니펫 템플릿({githubID}, 직접 고른 tz) 복사 + 아이디 입력 시 카드 미리보기
src/server/
  app.ts       Hono 라우트, 메모리·Runtime Cache 캐시, AppType export
  github.ts    GraphQL 쿼리 2개 (기여 내역 / 상위 저장소 커밋 시각)
  analyze.ts   4축 판정 (순수 함수, 기준값·별명 모음)
  card.ts      SVG 렌더 + escapeXml
  index.ts     로컬 node 서버 (env.ts 로 .env 로드)
__test__/      Jest 테스트 (판정 로직·카드 이스케이프). fixtures.ts 로 활동 데이터를 만든다
```

## 명령어

```bash
pnpm install
pnpm dev         # web(5173) + api(8787) 동시 실행
pnpm typecheck   # 타입 검사 (typescript 7)
pnpm lint        # ESLint
pnpm format      # Prettier 로 서식 맞추기 (검사만: pnpm format:check)
pnpm test        # Jest (__test__/*.test.ts)
pnpm build
```

- `typescript-eslint` 는 TypeScript JS API 가 필요한데 typescript 7 에는 없어서, `.pnpmfile.cjs` 가 그 패키지들에만 `@typescript/typescript6` 을 연결한다. 같은 이유로 Jest 는 `ts-jest` 대신 `@swc/jest` 로 변환한다 (타입 검사는 하지 않음)
- Prettier 서식: 기본은 세미콜론 없음·작은따옴표·120자, `src/web/App.tsx`·`index.css` 만 세미콜론·큰따옴표·80자 (`.prettierrc.json`)

## 규칙

- SVG 응답에는 `Cache-Control` 을 명시한다. 카드는 1시간(이후 하루 동안 stale-while-revalidate), 오류 카드는 5분 — GitHub camo 캐싱과 rate limit 때문.
- README(camo)는 200 이 아니면 이미지를 깨뜨리므로, 카드 엔드포인트의 오류는 **200 + 오류 카드** 로 응답한다.
- camo 는 약 4.2초 안에 응답이 끝나지 않으면 이미지를 깨뜨리고, 본문이 잘리면 빈 이미지를 캐싱한다. 그래서 카드 엔드포인트는 조회를 **최대 1.5초**만 기다리고, 넘으면 `no-store` 로 '카드를 만드는 중' 안내 카드를 보낸다. 조회는 `waitUntil`(`@vercel/functions`)로 끝까지 마쳐 캐시에 남긴다.
- 웹은 미리보기 결과가 나오면 **스니펫과 똑같은 카드 주소**를 한 번 불러 CDN 캐시를 채운다(`warmCard`). 미리보기 카드 주소(`?tz=&layout=`)와 스니펫 주소는 CDN 캐시 키가 달라서, 이렇게 해야 README 에 붙여 넣은 첫 요청이 기다리지 않는다.
- 외부 입력(GitHub 아이디, 이름, 언어명, tz 등)은 SVG에 넣기 전에 **반드시 XML 이스케이프** (`src/server/card.ts`의 `escapeXml`).
- GraphQL 쿼리에 사용자 값을 문자열로 끼워 넣지 않는다. 항상 **변수**로 전달한다.
- GitHub API 호출은 사용자 1명당 쿼리 2번(실측 2포인트) 이내로 유지하고, 결과는 서버에서 캐싱한다 (rate limit: 토큰당 5,000포인트/시간). 캐시에 없는 아이디의 새 조회는 IP당 10분 30번으로 제한하고(`x-real-ip`), 메모리 캐시·제한 기록은 최대 항목 수를 둔다. IP 제한은 인스턴스마다 따로 세므로, Contributions 쿼리의 `rateLimit` 으로 받은 토큰 전체의 남은 포인트가 500 이하면 새 조회를, 100 이하면 1시간 지난 결과의 새로 고침을 멈춘다 (GitHub 가 `RATE_LIMITED` 로 거절하면 10분 동안 부르지 않는다).
- 조회 결과는 메모리 캐시 아래에 **Vercel Runtime Cache**(`getCache`, 7일 TTL)를 둔다. 배포·인스턴스가 바뀌어도 남아서 콜드 요청도 GitHub 를 다시 부르지 않는다. 저장한 지 1시간이 지난 결과는 바로 쓰고 새 결과는 `waitUntil` 로 뒤에서 받아 바꾼다 (stale-while-revalidate). 로컬·테스트에서는 `@vercel/functions` 가 메모리 캐시로 대신한다. 보관 기간을 바꾸면 README·웹의 개인정보 안내도 함께 고친다.
- `src/web` 은 `src/server` 에서 `import type` 만 한다 (서버 런타임 코드가 웹 번들에 섞이지 않게).
- 판정 기준값·축 이름·별명은 `src/server/analyze.ts` 에 모아 두고, 판정 함수는 순수 함수로 유지한다.
- `.env*` 파일(`.env.example` 포함)은 **절대 커밋하지 않는다**. 필요한 환경변수는 README에 문서화한다.
- 라이브러리 API는 기억에 의존하지 말고 설치된 버전의 문서(node_modules 내 타입/README, 공식 문서)를 확인한다.
- 변수 선언에 `var` 를 쓰지 않는다. `const` 를 기본으로 하고, 재할당이 필요할 때만 `let` 을 쓴다.
- 커밋은 사용자에게 확인받은 뒤에만 한다.

## 커밋 메시지

헤더는 `<타입>: <제목>` 형식으로 쓴다 (예: `feat: 일촌평 작성 API 추가`). 타입은 아래 중 하나를 고른다.

| 타입 | 용도 |
| --- | --- |
| `init` | 초기 설정, npm 모듈 설치 등 |
| `feat` | 기능 추가, 변경 |
| `remove` | 파일이나 코드 삭제 |
| `fix` | 버그, 오류 수정 |
| `docs` | README.md, JSON 파일 등 수정, 라이브러리 설치 (문서 관련, 코드 수정 없음) |
| `style` | CSS 등 사용자 UI 디자인 변경 (제품 코드 수정 발생, 코드 형식, 정렬, 주석 등의 변경) |
| `refactor` | 코드 리팩토링 |
| `test` | 테스트 코드 추가, 삭제, 변경 등 (코드 수정 없음, 테스트 코드에 관련된 모든 변경에 해당) |
| `chore` | 패키지 매니저 설정, 기타 |
