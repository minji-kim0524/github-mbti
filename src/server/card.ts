import type { MbtiResult } from './analyze.js'

/** SVG(XML)에 넣는 모든 외부 입력은 반드시 이 함수를 거친다. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0에서 허용되지 않는 제어 문자 제거
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

const WIDTH = 600
const PADDING = 24
// README 이미지는 웹폰트를 불러올 수 없으므로 시스템 폰트로 대체된다
const FONT = `Pretendard, -apple-system, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif`

// 가로 배치: 왼쪽 1/3 은 캐릭터 이미지, 오른쪽 2/3 은 축별 막대
const COLUMN_GAP = 24
const LEFT_WIDTH = Math.round((WIDTH - PADDING * 2) / 3)
const BAR_X = PADDING + LEFT_WIDTH + COLUMN_GAP
const BAR_WIDTH = WIDTH - PADDING - BAR_X
/** 성향 이름과 근거 문구 사이 간격(px) */
const EVIDENCE_GAP = 4

const COLORS = {
  background: '#ffffff',
  border: '#e4e2f0',
  text: '#24292f',
  muted: '#6e7781',
  accent: '#6f42c1',
  track: '#eeeaf7',
}

function frame(height: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <style>
    text { font-family: ${FONT}; fill: ${COLORS.text}; }
    .title { font-size: 14px; font-weight: 600; fill: ${COLORS.muted}; }
    .nickname { font-size: 18px; font-weight: 700; }
    .side { font-size: 13px; fill: ${COLORS.muted}; }
    .side.on { fill: ${COLORS.accent}; font-weight: 700; }
    .evidence { font-size: 11px; fill: ${COLORS.muted}; }
    .footer { font-size: 10px; fill: ${COLORS.muted}; }
  </style>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  ${body}
</svg>`
}

export function renderCard(result: MbtiResult): string {
  // 카드에 유형 글자를 따로 쓰지 않으므로 화면 낭독기용 제목에 유형을 넣어 둔다
  const title = `${escapeXml(result.login)}의 깃허브 MBTI: ${escapeXml(result.type)}`
  const top = 32
  const rowHeight = 52

  // 막대 아래 줄: 양 끝에 성향 이름, 근거는 판정된 쪽 이름 옆에 붙인다.
  // SVG 는 글자 폭을 잴 수 없으므로 이름과 근거를 한 <text> 안의 <tspan> 으로 이어 쓰고 dx 로 간격을 둔다.
  const rows = result.axes.map((axis, i) => {
    const y = top + i * rowHeight
    const leftOn = axis.letter === axis.left.letter
    const fill = Math.max(0, Math.min(1, axis.score)) * BAR_WIDTH
    const gap = ` dx="${EVIDENCE_GAP}"`
    const evidence = (dx: string) => `<tspan class="evidence"${dx}>${escapeXml(axis.evidence)}</tspan>`
    const leftName = `<tspan class="side${leftOn ? ' on' : ''}">${escapeXml(axis.left.name)}</tspan>`
    const rightName = `<tspan class="side${leftOn ? '' : ' on'}"${leftOn ? '' : gap}>${escapeXml(axis.right.name)}</tspan>`
    const leftLine = leftOn ? leftName + evidence(gap) : leftName
    const rightLine = leftOn ? rightName : evidence('') + rightName
    return [
      `<rect x="${BAR_X}" y="${y}" width="${BAR_WIDTH}" height="10" rx="5" fill="${COLORS.track}"/>`,
      `<rect x="${BAR_X}" y="${y}" width="${fill.toFixed(1)}" height="10" rx="5" fill="${COLORS.accent}"/>`,
      `<text x="${BAR_X}" y="${y + 28}">${leftLine}</text>`,
      `<text x="${BAR_X + BAR_WIDTH}" y="${y + 28}" text-anchor="end">${rightLine}</text>`,
    ].join('\n  ')
  })

  const rowsBottom = top + result.axes.length * rowHeight
  const height = rowsBottom + 28
  const centerX = PADDING + LEFT_WIDTH / 2
  const radius = 80
  // 막대 영역(첫 막대 ~ 마지막 근거 줄)의 세로 가운데에 맞춘다
  const imageY = (top + rowsBottom - rowHeight + 28) / 2
  const timeZoneNote = result.timeZoneAutoDetected ? `시간대 자동 감지 (${result.timeZone})` : result.timeZone
  const body = [
    // 캐릭터 이미지 자리 (이미지가 준비되면 이 원 안에 넣는다)
    `<circle cx="${centerX}" cy="${imageY}" r="${radius}" fill="${COLORS.track}"/>`,
    ...rows,
    `<text x="${WIDTH - PADDING}" y="${height - 12}" class="footer" text-anchor="end">*최근 1년 공개 커밋 기준 · ${escapeXml(timeZoneNote)}</text>`,
  ].join('\n  ')

  return frame(height, title, body)
}

export function renderErrorCard(message: string): string {
  const title = '깃허브 MBTI'
  return frame(
    90,
    title,
    `<text x="${PADDING}" y="36" class="title">${title}</text>
  <text x="${PADDING}" y="62" class="nickname">${escapeXml(message)}</text>`,
  )
}
