import { useEffect, useState, type FormEvent } from 'react'
import { client } from './api'

/** 커밋 시각의 오프셋으로 시간대를 자동 감지하라는 tz 값 */
const AUTO_TIME_ZONE = 'auto'
const TIME_ZONES = [AUTO_TIME_ZONE, 'Asia/Seoul', 'Asia/Tokyo', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles']
const ID_PLACEHOLDER = '{githubID}'
/** 이 폭 이하 화면에서는 세로 배치(compact) 카드를 보여 준다. 가로 카드(600px)를 줄이면 글자를 읽기 어렵다 */
const COMPACT_MEDIA = '(max-width: 599px)'
/** 저장하는 PNG 해상도 배율 (고해상도 화면·SNS 에서 흐려지지 않게) */
const PNG_SCALE = 2

type Result = {
  login: string
  type: string
  nickname: string
}

/**
 * README에 붙여 넣을 스니펫. 사람이 읽고 고치기 쉽게 tz 는 인코딩하지 않는다.
 * README 이미지는 GitHub 테마를 따라가지 못하므로, <picture> 로 다크 테마에서는 theme=dark 카드를 고르게 한다
 */
function buildSnippet(login: string, timeZone: string): string {
  const origin = location.origin
  const card = `${origin}/api/card/${login}?tz=${timeZone}`
  return [
    `<a href="${origin}">`,
    `  <picture>`,
    `    <source media="(prefers-color-scheme: dark)" srcset="${card}&theme=dark" />`,
    `    <img src="${card}" alt="깃허브 MBTI" />`,
    `  </picture>`,
    `</a>`,
  ].join('\n')
}

/** 이 주소를 열면 같은 아이디·시간대로 바로 미리보기를 보여 준다 */
function buildShareUrl(login: string, timeZone: string): string {
  return `${location.origin}/?${new URLSearchParams({ user: login, tz: timeZone })}`
}

/** 카드 SVG 를 PNG 로 바꾼다. 같은 출처 이미지라 canvas 에 그린 뒤 꺼낼 수 있다 */
async function svgToPng(path: string): Promise<Blob> {
  const img = new Image()
  img.src = path
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth * PNG_SCALE
  canvas.height = img.naturalHeight * PNG_SCALE
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 변환 실패'))), 'image/png'),
  )
}

export function App() {
  // 공유 링크(?user=&tz=)로 들어오면 그 값으로 시작한다
  const [initial] = useState(() => new URLSearchParams(location.search))
  const [login, setLogin] = useState(initial.get('user') ?? '')
  const [timeZone, setTimeZone] = useState(initial.get('tz') ?? AUTO_TIME_ZONE)
  const [result, setResult] = useState<Result | null>(null)
  // 미리보기를 요청한 시점의 tz (선택 상자를 바꿔도 미리보기 카드와 어긋나지 않게 따로 둔다)
  const [previewTimeZone, setPreviewTimeZone] = useState(AUTO_TIME_ZONE)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // 방금 끝난 동작(복사·저장 등). 버튼 글자를 잠깐 바꿔 알려 준다
  const [done, setDone] = useState<string | null>(null)

  const user = login.trim()
  const snippet = buildSnippet(user || ID_PLACEHOLDER, timeZone)

  const preview = async (target: string, tz: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await client.api.mbti[':user'].$get({ param: { user: target }, query: { tz } })
      const data = await res.json()
      if ('error' in data) {
        setResult(null)
        setError(data.error)
      } else {
        setResult(data)
        setPreviewTimeZone(tz)
        // 주소창 주소를 그대로 공유해도 같은 결과가 보이도록 맞춘다
        history.replaceState(null, '', buildShareUrl(data.login, tz))
      }
    } catch {
      setError('분석하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const shared = initial.get('user')?.trim()
    if (shared) void preview(shared, initial.get('tz') ?? AUTO_TIME_ZONE)
    // 처음 들어왔을 때 한 번만 실행한다
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (user) void preview(user, timeZone)
  }

  const flash = (key: string) => {
    setDone(key)
    setTimeout(() => setDone((current) => (current === key ? null : current)), 1500)
  }

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flash(key)
    } catch {
      // 클립보드 권한이 막힌 환경(일부 인앱 브라우저 등)
      setError('복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.')
    }
  }

  const cardPath = (layout?: 'compact') =>
    result
      ? `/api/card/${encodeURIComponent(result.login)}?${new URLSearchParams({ tz: previewTimeZone, ...(layout && { layout }) })}`
      : ''

  const shareUrl = result ? buildShareUrl(result.login, previewTimeZone) : ''
  const shareText = result ? `내 깃허브 MBTI는 ${result.type}, "${result.nickname}"! 당신의 깃허브 MBTI는?` : ''
  const fileName = result ? `github-mbti-${result.login}.png` : ''
  // 화면에 보이는 것과 같은 배치(가로/세로)로 저장한다
  const visibleCardPath = () => cardPath(matchMedia(COMPACT_MEDIA).matches ? 'compact' : undefined)

  const savePng = async () => {
    try {
      const url = URL.createObjectURL(await svgToPng(visibleCardPath()))
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      flash('save')
    } catch {
      setError('이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  // Web Share API 를 지원하면 시스템 공유 창을 띄운다. 이미지 파일을 받을 수 있는 곳이면 카드 PNG 도 함께 보낸다.
  // 지원하지 않는 브라우저에서는 결과 링크를 복사해 대신한다
  const share = async () => {
    if (typeof navigator.share !== 'function') {
      await copy('share', shareUrl)
      return
    }
    try {
      const file = new File([await svgToPng(visibleCardPath())], fileName, { type: 'image/png' })
      const data = navigator.canShare?.({ files: [file] }) ? { files: [file], text: shareText, url: shareUrl } : { text: shareText, url: shareUrl }
      await navigator.share(data)
    } catch (e) {
      // 사용자가 공유 창을 닫은 경우는 오류가 아니다
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError('공유하지 못했어요. 링크 복사를 이용해 주세요.')
    }
  }

  return (
    <main>
      <h1>내 깃허브의 MBTI는 무엇일까?</h1>
      <p className="desc">
        <small>
          *커밋 내역을 기반으로 측정됩니다.
          <br />
          재미로 보는 비공식 개발자 성향 테스트예요. 활동 기록만으로 실제 성격을 정확히 알 수는 없고, 공식 MBTI® 검사와도
          관련이 없어요.
        </small>
      </p>

      <section>
        <div className="section-head">
          <h2>README에 붙여넣기</h2>
          <button type="button" onClick={() => copy('snippet', snippet)}>
            {done === 'snippet' ? '복사됐어요' : '복사하기'}
          </button>
        </div>
        <pre>{snippet}</pre>
        <ul className="guide">
          <li>
            <code>{ID_PLACEHOLDER}</code> 자리(두 곳)에 내 GitHub 아이디를 넣어 주세요. 아래에 아이디를 입력하면 자동으로 채워져요.
          </li>
          <li>
            GitHub를 다크 테마로 보는 사람에게는 어두운 카드(<code>theme=dark</code>)가, 라이트 테마에서는 밝은 카드가 보여요.
          </li>
          <li>
            <code>tz=auto</code> 는 커밋 시각에 기록된 시간대로 자동 감지해요. 직접 지정하려면{' '}
            <code>tz=Asia/Seoul</code> 처럼{' '}
            <a href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones" target="_blank" rel="noreferrer">
              IANA 시간대 이름
            </a>
            을 넣어 주세요.
          </li>
        </ul>
      </section>

      <section>
        <h2>미리보기</h2>
        <form onSubmit={submit}>
          <input
            placeholder="GitHub 아이디"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
          />
          <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} aria-label="시간대">
            {TIME_ZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz === AUTO_TIME_ZONE ? 'auto (자동 감지)' : tz}
              </option>
            ))}
          </select>
          <button type="submit" disabled={loading || !user}>
            {loading ? '분석 중…' : '미리보기'}
          </button>
        </form>

        {error && <p className="error">{error}</p>}
        {result && (
          <>
            <picture>
              <source media={COMPACT_MEDIA} srcSet={cardPath('compact')} />
              <img className="card" src={cardPath()} alt={`${result.login}의 깃허브 MBTI: ${result.type}`} />
            </picture>
            <div className="share" role="group" aria-label="결과 공유">
              <button type="button" onClick={savePng}>
                {done === 'save' ? '저장됐어요' : '이미지 저장'}
              </button>
              <button type="button" className="secondary" onClick={() => copy('link', shareUrl)}>
                {done === 'link' ? '복사됐어요' : '링크 복사'}
              </button>
              <button type="button" className="secondary" onClick={share}>
                {done === 'share' ? '링크를 복사했어요' : '결과 공유하기'}
              </button>
            </div>
          </>
        )}
      </section>

      <section>
        <h2>데이터 수집과 개인정보</h2>
        <ul className="guide">
          <li>
            로그인 없이 GitHub <b>공개 활동만</b> 읽어요. 프로필 이름, 최근 1년의 잔디, 커밋한 저장소의 주 언어, 상위 저장소의
            커밋 시각, PR·리뷰 수가 전부예요.
          </li>
          <li>커밋 메시지, 코드, 이메일 주소, 비공개 저장소의 내용은 읽지 않아요.</li>
          <li>
            데이터베이스가 없어요. 조회한 데이터는 서버 메모리에 최대 1시간 두었다가 버리고, 쿠키나 방문 분석 도구도 쓰지 않아요.
          </li>
          <li>이미지 저장은 브라우저 안에서 처리되고, 공유는 직접 버튼을 누를 때만 동작해요.</li>
          <li>
            자세한 내용은{' '}
            <a href="https://github.com/minji-kim0524/github-mbti#data--privacy" target="_blank" rel="noreferrer">
              README의 Data &amp; privacy
            </a>
            에서 볼 수 있어요.
          </li>
        </ul>
      </section>
    </main>
  )
}
