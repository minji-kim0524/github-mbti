import { useEffect, useRef, useState, type FormEvent } from "react";
import { Toaster, toast } from "sonner";
import { client } from "./api";

/** 커밋 시각의 오프셋으로 시간대를 자동 감지하라는 tz 값 */
const AUTO_TIME_ZONE = "auto";
const TIME_ZONES = [
  AUTO_TIME_ZONE,
  "Asia/Seoul",
  "Asia/Tokyo",
  "UTC",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];
const ID_PLACEHOLDER = "{githubID}";
/** 이 폭 이하 화면에서는 세로 배치(compact) 카드를 보여 준다. 가로 카드(600px)를 줄이면 글자를 읽기 어렵다 */
const COMPACT_MEDIA = "(max-width: 599px)";
/**
 * 스니펫 카드를 미리 불러올 때, 서버가 아직 만드는 중(no-store)이면 다시 시도하는 간격과 횟수.
 * 서버는 카드 응답을 1.5초까지만 기다리고, 그 사이에도 조회를 계속하므로 조금 뒤 다시 부르면 완성된 카드를 받는다
 */
const WARM_RETRY_MS = 3000;
const WARM_RETRIES = 2;
/** 저장하는 PNG 해상도 배율 (고해상도 화면·SNS 에서 흐려지지 않게) */
const PNG_SCALE = 2;
/**
 * iPhone·iPad 인지. 다운로드한 파일이 사진 앱이 아니라 파일 앱으로 가서, 공유 시트로 저장하게 한다
 * (Android 는 다운로드 폴더가 갤러리에 바로 보이므로 다운로드로 충분하다).
 * iPadOS 는 Mac 처럼 보이는 user agent 를 쓰므로 터치 지원 여부로 구분한다
 */
function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

type Result = {
  login: string;
  type: string;
  nickname: string;
};

/**
 * README 스니펫에 들어가는 카드 주소. 사람이 읽고 고치기 쉽게 tz 는 인코딩하지 않는다.
 * tz 는 생략하면 auto 와 같으므로 직접 고른 경우에만 붙인다
 */
function buildCardUrl(login: string, timeZone: string): string {
  const query = timeZone === AUTO_TIME_ZONE ? "" : `?tz=${timeZone}`;
  return `${location.origin}/api/card/${login}${query}`;
}

/** README에 붙여 넣을 마크다운 한 줄 */
function buildSnippet(login: string, timeZone: string): string {
  return `[![깃허브 MBTI](${buildCardUrl(login, timeZone)})](${location.origin})`;
}

/**
 * 스니펫과 똑같은 주소의 카드를 한 번 불러 CDN 에 캐시해 둔다.
 * README 에 붙여 넣은 뒤 GitHub 이미지 프록시(camo)가 처음 요청할 때 기다리지 않고 바로 받아 가게 하려는 것이다
 */
async function warmCard(url: string): Promise<void> {
  for (let attempt = 0; attempt <= WARM_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, WARM_RETRY_MS));
    }
    const res = await fetch(url);
    if (res.headers.get("Cache-Control") !== "no-store") return;
  }
}

/** 이 주소를 열면 같은 아이디·시간대로 바로 미리보기를 보여 준다 */
function buildShareUrl(login: string, timeZone: string): string {
  return `${location.origin}/?${new URLSearchParams({ user: login, tz: timeZone })}`;
}

/** 카드 SVG 를 PNG 로 바꾼다. 같은 출처 이미지라 canvas 에 그린 뒤 꺼낼 수 있다 */
async function svgToPng(path: string): Promise<Blob> {
  const img = new Image();
  img.src = path;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth * PNG_SCALE;
  canvas.height = img.naturalHeight * PNG_SCALE;
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG 변환 실패"))),
      "image/png",
    ),
  );
}

export function App() {
  // 공유 링크(?user=&tz=)로 들어오면 그 값으로 시작한다
  const [initial] = useState(() => new URLSearchParams(location.search));
  const [login, setLogin] = useState(initial.get("user") ?? "");
  const [timeZone, setTimeZone] = useState(initial.get("tz") ?? AUTO_TIME_ZONE);
  const [result, setResult] = useState<Result | null>(null);
  // 미리보기를 요청한 시점의 tz (선택 상자를 바꿔도 미리보기 카드와 어긋나지 않게 따로 둔다)
  const [previewTimeZone, setPreviewTimeZone] = useState(AUTO_TIME_ZONE);
  // 분석 실패 안내. 결과 자리를 대신하는 내용이라 토스트가 아니라 모달로 띄운다
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const user = login.trim();
  const snippet = buildSnippet(user || ID_PLACEHOLDER, timeZone);

  const preview = async (target: string, tz: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.api.mbti[":user"].$get({
        param: { user: target },
        query: { tz },
      });
      const data = await res.json();
      if ("error" in data) {
        setResult(null);
        setError(data.error);
      } else {
        setResult(data);
        setPreviewTimeZone(tz);
        // 주소창 주소를 그대로 공유해도 같은 결과가 보이도록 맞춘다
        history.replaceState(null, "", buildShareUrl(data.login, tz));
      }
    } catch {
      setError("분석하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  // 공유 링크로 처음 들어왔을 때 한 번만 결과를 불러온다 (서버 조회라 effect 에서 상태를 바꾼다)
  useEffect(() => {
    const shared = initial.get("user")?.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shared) void preview(shared, initial.get("tz") ?? AUTO_TIME_ZONE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (user) void preview(user, timeZone);
  };

  useEffect(() => {
    if (error) dialogRef.current?.showModal();
  }, [error]);

  // 모달이 닫히면(버튼·Esc·바깥 클릭) 바로 다시 입력할 수 있게 아이디 입력란을 선택해 둔다
  // 브라우저가 dialog 를 닫으며 이전 포커스를 되돌린 뒤에 옮겨야 하므로 다음 프레임에 실행한다
  const onDialogClose = () => {
    setError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      // 클립보드 권한이 막힌 환경(일부 인앱 브라우저 등)
      toast.error("복사하지 못했어요. 직접 선택해서 복사해 주세요.");
    }
  };

  const cardPath = (layout?: "compact") =>
    result
      ? `/api/card/${encodeURIComponent(result.login)}?${new URLSearchParams({ tz: previewTimeZone, ...(layout && { layout }) })}`
      : "";

  // 미리보기한 아이디의 스니펫 카드를 미리 불러 둔다. 입력 중인 다른 아이디는 부르지 않도록 결과와 같을 때만,
  // 같은 주소는 한 번만 부른다 (CDN 캐시는 결과가 1시간이 될 때까지 유지된다)
  const warmed = useRef(new Set<string>());
  useEffect(() => {
    if (!result || user.toLowerCase() !== result.login.toLowerCase()) return;
    const url = buildCardUrl(user, timeZone);
    if (warmed.current.has(url)) return;
    warmed.current.add(url);
    // 미리 불러오기는 보조 기능이라 실패해도 알리지 않는다
    warmCard(url).catch(() => warmed.current.delete(url));
  }, [result, user, timeZone]);

  const shareUrl = result ? buildShareUrl(result.login, previewTimeZone) : "";
  const fileName = result ? `github-mbti-${result.login}.png` : "";
  // 화면에 보이는 것과 같은 배치(가로/세로)로 저장한다
  const visibleCardPath = () =>
    cardPath(matchMedia(COMPACT_MEDIA).matches ? "compact" : undefined);

  // 공유 시트는 버튼을 누른 직후에만 열 수 있어서(iOS Safari 는 비동기 작업이 길면 거부한다)
  // 결과가 나오면 PNG 를 미리 만들어 둔다
  const pngCache = useRef<{ path: string; png: Promise<Blob> } | null>(null);
  useEffect(() => {
    if (!result) return;
    const path = visibleCardPath();
    const png = svgToPng(path);
    // 미리 만들다 실패해도 버튼을 누를 때 다시 만든다
    png.catch(() => {});
    pngCache.current = { path, png };
    // visibleCardPath 는 result·previewTimeZone 으로만 바뀌는 함수라 그 둘만 의존한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, previewTimeZone]);

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("이미지가 저장되었습니다.");
  };

  const savePng = async () => {
    const path = visibleCardPath();
    let blob: Blob;
    try {
      const cached = pngCache.current;
      blob = await (cached?.path === path
        ? cached.png.catch(() => svgToPng(path))
        : svgToPng(path));
    } catch {
      toast.error("이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }

    // 웹페이지는 사진 앱에 바로 쓸 수 없어서, iPhone·iPad 는 공유 시트의 '이미지 저장'으로 저장하게 한다.
    // 시트에서 무엇을 골랐는지는 알 수 없으므로 저장 완료 대신 방법을 먼저 안내한다
    const file = new File([blob], fileName, { type: blob.type });
    if (isAppleMobile() && navigator.canShare?.({ files: [file] })) {
      toast("공유 메뉴에서 '이미지 저장'을 누르면 사진 앱에 저장돼요");
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        // 사용자가 공유 시트를 닫은 경우
        if (e instanceof DOMException && e.name === "AbortError") return;
        // 그 밖의 공유 실패는 파일 다운로드로 대신한다
      }
    }
    download(blob);
  };

  return (
    <main>
      <h1>내 깃허브의 MBTI는 무엇일까?</h1>
      <p className="desc">
        <small>
          *커밋 내역을 기반으로 측정됩니다.
          <br />
          *재미로 보는 비공식 개발자 성향 테스트입니다. 활동 기록만으로 실제
          성격을 정확히 알 수 없으며, 공식 MBTI® 검사와 무관합니다.
        </small>
      </p>

      <section>
        <div className="section-head">
          <h2>README에 붙여넣기</h2>
          <button
            type="button"
            onClick={() => copy(snippet, "README 코드를 복사했어요")}
          >
            복사하기
          </button>
        </div>
        <pre>{snippet}</pre>
        <ul className="guide">
          <li>
            <b>아이디를 입력하고 미리보기를 먼저 진행해 주세요.</b> 미리보기를
            하지 않으면 카드가 결과를 불러오는 데 최대 5분 정도 걸릴 수 있어요.
          </li>
          <li>
            <code>{ID_PLACEHOLDER}</code> 자리에 내 GitHub 아이디를 넣어 주세요.
            아래에 아이디를 입력하면 자동으로 채워져요.
          </li>
          <li>
            시간대는 커밋 시각에 기록된 값으로 자동 감지해요. 직접 지정하려면
            카드 주소 끝에 <code>?tz=Asia/Seoul</code> 처럼{" "}
            <a
              href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones"
              target="_blank"
              rel="noreferrer"
            >
              IANA 시간대 이름
            </a>
            을 넣어 주세요.
          </li>
          <li>
            어두운 카드는 주소 끝에 <code>?theme=dark</code>(다른 값 뒤라면{" "}
            <code>&amp;theme=dark</code>)를 붙여요. 카드 크기를 바꾸려면{" "}
            <code>&lt;img src="카드 주소" width="400" /&gt;</code> 처럼 HTML로
            써 주세요.
          </li>
          <li>
            README 카드는 지우기 전까지 계속 보여요. 결과가 1시간이 지나면 기존
            카드를 보여 주면서 뒤에서 새 커밋을 반영하니, 아래 미리보기와 잠시
            다를 수 있어요.
          </li>
        </ul>
      </section>

      <section>
        <h2>미리보기</h2>
        <form onSubmit={submit}>
          <input
            ref={inputRef}
            placeholder="GitHub 아이디"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
          />
          <select
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            aria-label="시간대"
          >
            {TIME_ZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz === AUTO_TIME_ZONE ? "auto (자동 감지)" : tz}
              </option>
            ))}
          </select>
          <button type="submit" disabled={loading || !user}>
            {loading ? "분석 중…" : "미리보기"}
          </button>
        </form>

        {result && (
          <>
            <picture>
              <source media={COMPACT_MEDIA} srcSet={cardPath("compact")} />
              <img
                className="card"
                src={cardPath()}
                alt={`${result.login}의 깃허브 MBTI: ${result.type}`}
              />
            </picture>
            <div className="share" role="group" aria-label="결과 공유">
              <button type="button" onClick={savePng}>
                이미지 저장
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => copy(shareUrl, "결과 링크를 복사했어요")}
              >
                링크 복사
              </button>
            </div>
          </>
        )}
      </section>

      <section>
        <h2>데이터 수집과 개인정보</h2>
        <ul className="guide">
          <li>
            로그인 없이 GitHub <b>공개 활동만</b> 읽어요. 프로필 이름, 최근
            1년의 잔디, 커밋한 저장소의 주 언어, 상위 저장소의 커밋 시각,
            PR·리뷰 수가 전부예요.
          </li>
          <li>
            커밋 메시지, 코드, 이메일 주소, 비공개 저장소의 내용은 읽지 않아요.
          </li>
          <li>
            README 카드가 계속 보이도록 조회한 공개 활동 데이터를 아이디별로
            보관하고, 1시간이 지나면 새로 받아 바꿔 둬요. 보관한 결과를 지우고
            싶다면 README에서 카드를 지운 뒤 이슈로 알려 주세요. 쿠키나 방문
            분석 도구는 쓰지 않아요.
          </li>
          <li>
            이미지 저장은 브라우저 안에서 처리되어 서버로 다시 보내지 않아요.
          </li>
          <li>
            자세한 내용은{" "}
            <a
              href="https://github.com/minji-kim0524/github-mbti#data--privacy"
              target="_blank"
              rel="noreferrer"
            >
              README의 Data &amp; privacy
            </a>
            에서 볼 수 있어요.
          </li>
        </ul>
      </section>

      {/* 바깥(배경)을 누르면 닫는다. 안쪽 클릭은 target 이 .alert-body 나 그 자식이라 닫히지 않는다 */}
      <dialog
        ref={dialogRef}
        className="alert"
        aria-labelledby="alert-title"
        onClose={onDialogClose}
        onClick={(e) =>
          e.target === e.currentTarget && dialogRef.current?.close()
        }
      >
        <div className="alert-body">
          <h2 id="alert-title">결과를 불러오지 못했어요</h2>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            autoFocus
          >
            다시 입력하기
          </button>
        </div>
      </dialog>
      <Toaster
        position="bottom-center"
        toastOptions={{ style: { fontFamily: "inherit" } }}
      />
    </main>
  );
}
