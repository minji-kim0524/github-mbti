import { useState, type FormEvent } from 'react'
import { client } from './api'

const TIME_ZONES = ['Asia/Seoul', 'Asia/Tokyo', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles']
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

type Result = {
  login: string
  type: string
  nickname: string
  timeZone: string
  axes: { key: string; label: string; trait: string; evidence: string; insufficient: boolean }[]
}

export function App() {
  const [login, setLogin] = useState('')
  const [timeZone, setTimeZone] = useState(TIME_ZONES.includes(browserTimeZone) ? browserTimeZone : 'Asia/Seoul')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const user = login.trim()
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
      }
    } catch {
      setError('분석하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  const query = new URLSearchParams({ tz: result?.timeZone ?? timeZone }).toString()
  const cardPath = result ? `/api/card/${encodeURIComponent(result.login)}?${query}` : ''
  const snippet = result
    ? `<a href="${location.origin}"><img src="${location.origin}${cardPath}" alt="깃허브 MBTI" /></a>`
    : ''

  return (
    <main>
      <h1>깃허브 MBTI</h1>
      <p className="desc">
        내 깃허브의 MBTI는 무엇일까?
        <br />
        <small>*커밋 내역을 기반으로 측정됩니다.</small>
      </p>

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
              {tz}
            </option>
          ))}
        </select>
        <button type="submit" disabled={loading || !login.trim()}>
          {loading ? '분석 중…' : '측정하기'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <>
          <section>
            <img className="card" src={cardPath} alt={`${result.login}의 깃허브 MBTI: ${result.type}`} />
          </section>
          <section>
            <h2>README에 붙여넣기</h2>
            <pre>{snippet}</pre>
            <button type="button" onClick={() => navigator.clipboard.writeText(snippet)}>
              복사하기
            </button>
          </section>
        </>
      )}
    </main>
  )
}
