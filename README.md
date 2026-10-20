# 깃허브 MBTI

> 내 깃허브의 MBTI는 무엇일까? (*커밋 내역을 기반으로 측정됩니다.)

GitHub 공개 활동을 분석해 4글자 개발자 유형을 카드로 보여 줍니다. 프로필 README에 이미지로 붙여 넣을 수 있어요.

```md
<a href="https://<도메인>"><img src="https://<도메인>/api/card/<GitHub 아이디>?tz=Asia/Seoul" alt="깃허브 MBTI" /></a>
```

## 4가지 축 (초안)

| 축 | 유형 | 측정 기준 |
| --- | --- | --- |
| 시간 | **N** 새벽형 / **D** 아침형 | 커밋 시각 (`tz` 파라미터 기준, 기본 `Asia/Seoul`) |
| 리듬 | **S** 꾸준형 / **B** 몰아치기형 | 1년 중 기여한 날의 비율 |
| 범위 | **F** 한 우물형 / **E** 잡식형 | 커밋한 저장소의 언어 집중도 |
| 협업 | **L** 솔로형 / **T** 협업형 | 남의 저장소 커밋 비율, PR·리뷰 수 |

- 최근 1년의 **공개** 활동만 반영됩니다. 비공개 저장소는 개수만 알 수 있어 판정에서 빠집니다.
- 커밋 시각은 커밋을 가장 많이 한 저장소 5곳의 기본 브랜치 커밋(저장소당 최근 100개)을 기준으로 합니다.

## 로컬 실행

요구사항: Node.js 22+, pnpm 10+

```bash
pnpm install
```

```bash
pnpm dev
```

- 웹: http://localhost:5173 (`/api` 요청은 API 서버로 프록시)
- API: http://localhost:8787
- 카드 예시: http://localhost:5173/api/card/octocat?tz=Asia/Seoul

## 환경변수

`.env*` 파일은 커밋하지 않습니다(`.gitignore`에 포함). 로컬에서는 프로젝트 루트에 `.env`를 직접 만들어 사용하세요.

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 예 | GitHub GraphQL API 호출용 토큰. [Fine-grained token](https://github.com/settings/personal-access-tokens/new)을 **권한 없이(Public repositories 읽기 전용)** 발급하면 됩니다. |
| `PORT` | 아니오 | API 서버 포트 (기본값 `8787`) |

### API 사용량

GitHub GraphQL API는 무료이며, 토큰당 **시간당 5,000포인트**의 한도가 있습니다. 사용자 1명 분석에 약 7포인트를 쓰고, 결과를 12시간 동안 캐싱합니다.
