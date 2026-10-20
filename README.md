# 깃허브 MBTI

> 내 깃허브의 MBTI는 무엇일까? (*커밋 내역을 기반으로 측정됩니다.)

GitHub 공개 활동을 분석해 4글자 개발자 유형을 카드로 보여 줍니다. 프로필 README에 이미지로 붙여 넣을 수 있어요.

## 사용 방법

1. 아래 코드를 복사합니다.

   ```html
   <a href="https://<도메인>"><img src="https://<도메인>/api/card/{githubID}?tz=auto" alt="깃허브 MBTI" /></a>
   ```

2. `{githubID}`를 내 GitHub 아이디로 바꿉니다.
3. 필요하면 `tz` 값을 바꿉니다 (아래 표 참고).
4. 내 프로필 README(`<아이디>/<아이디>` 저장소의 `README.md`)에 붙여 넣으면 카드가 표시됩니다.

| `tz` 값 | 동작 |
| --- | --- |
| `auto` (기본) | 커밋 시각에 기록된 시간대(오프셋)로 자동 감지해요. 생략해도 같아요. |
| `Asia/Seoul`, `America/New_York` 등 | 모든 커밋을 그 시간대로 바꿔서 판정해요. [IANA 시간대 이름](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)을 넣어 주세요. |

- 서버·CI·컨테이너에서 커밋하면 시간대가 `UTC`로 잡힐 수 있어요. 카드 하단에 감지된 시간대가 표시되니, 실제와 다르면 `tz`를 직접 지정하세요.
- 카드는 12시간 동안 캐싱되므로 새 커밋이 바로 반영되지는 않아요.
- 웹 페이지(`https://<도메인>`)에서 아이디를 입력하면 붙여 넣기 전에 카드를 미리 볼 수 있어요.

## 4가지 축 (초안)

| 축 | 유형 | 측정 기준 |
| --- | --- | --- |
| 시간 | **N** 새벽형 / **D** 아침형 | 커밋 시각 (자동 감지, `tz` 파라미터로 지정 가능) |
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
- 카드 예시: http://localhost:5173/api/card/torvalds?tz=auto

## 환경변수

`.env*` 파일은 커밋하지 않습니다(`.gitignore`에 포함). 로컬에서는 프로젝트 루트에 `.env`를 직접 만들어 사용하세요.

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 예 | GitHub GraphQL API 호출용 토큰. [Fine-grained token](https://github.com/settings/personal-access-tokens/new)을 **권한 없이(Public repositories 읽기 전용)** 발급하면 됩니다. |
| `PORT` | 아니오 | API 서버 포트 (기본값 `8787`) |

## 배포 (Vercel)

`vite build` 결과(`dist`)는 정적 파일로, `api/index.ts`는 Vercel Function으로 배포됩니다. 설정은 `vercel.json`에 있습니다.

1. [Vercel](https://vercel.com/new)에서 이 GitHub 저장소를 Import 합니다 (빌드 설정은 `vercel.json`이 지정).
2. Project Settings → Environment Variables 에 `GITHUB_TOKEN`을 추가합니다.
3. 배포가 끝나면 README의 `<도메인>`을 실제 주소로 바꿉니다.

이후 `main`에 push 하면 자동으로 다시 배포됩니다.

### API 사용량

GitHub GraphQL API는 무료이며, 토큰당 **시간당 5,000포인트**의 한도가 있습니다. 사용자 1명 분석에 약 7포인트를 쓰고, 결과를 12시간 동안 캐싱합니다.
