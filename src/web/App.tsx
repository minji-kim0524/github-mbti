import { useState, type FormEvent } from 'react'
import { client } from './api'

/** 커밋 시각의 오프셋으로 시간대를 자동 감지하라는 tz 값 */
const AUTO_TIME_ZONE = 'auto'
const TIME_ZONES = [AUTO_TIME_ZONE, 'Asia/Seoul', 'Asia/Tokyo', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles']
const ID_PLACEHOLDER = '{githubID}'

type Result = {
  login: string
  type: string
}

/** README에 붙여 넣을 스니펫. 사람이 읽고 고치기 쉽게 tz 는 인코딩하지 않는다. */
function buildSnippet(login: string, timeZone: string): string {
  const origin = location.origin
  return `<a href="${origin}"><img src="${origin}/api/card/${login}?tz=${timeZone}" alt="깃허브 MBTI" /></a>`
}

export function App() {
  const [login, setLogin] = useState('')
  const [timeZone, setTimeZone] = useState(AUTO_TIME_ZONE)
  const [result, setResult] = useState<Result | null>(null)
  // 미리보기를 요청한 시점의 tz (선택 상자를 바꿔도 미리보기 카드와 어긋나지 않게 따로 둔다)
  const [previewTimeZone, setPreviewTimeZone] = useState(AUTO_TIME_ZONE)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const user = login.trim()
  const snippet = buildSnippet(user || ID_PLACEHOLDER, timeZone)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const res = await client.api.mbti[':user'].$get({ param: { user }, query: { tz: timeZone } })
      const data = await res.json()
      if ('error' in data) {
        setResult(null)
        setError(data.error)
      } else {
        setResult(data)
        setPreviewTimeZone(timeZone)
      }
    } catch {
      setError('분석하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const cardPath = result
    ? `/api/card/${encodeURIComponent(result.login)}?${new URLSearchParams({ tz: previewTimeZone })}`
    : ''

  return (
    <main>
      <h1>깃허브 MBTI</h1>
      <p className="desc">
        내 깃허브의 MBTI는 무엇일까?
        <br />
        <small>*커밋 내역을 기반으로 측정됩니다.</small>
      </p>

      <section>
        <h2>README에 붙여넣기</h2>
        <pre>{snippet}</pre>
        <button type="button" onClick={copy}>
          {copied ? '복사됐어요' : '복사하기'}
        </button>
        <ul className="guide">
          <li>
            <code>{ID_PLACEHOLDER}</code> 자리에 내 GitHub 아이디를 넣어 주세요. 아래에 아이디를 입력하면 자동으로 채워져요.
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
        {result && <img className="card" src={cardPath} alt={`${result.login}의 깃허브 MBTI: ${result.type}`} />}
      </section>
    </main>
  )
}
