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

const WIDTH = 495
const PADDING = 24
// README 이미지는 웹폰트를 불러올 수 없으므로 시스템 폰트로 대체된다
const FONT = `Pretendard, -apple-system, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif`

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
    .type { font-size: 40px; font-weight: 800; letter-spacing: 4px; fill: ${COLORS.accent}; }
    .nickname { font-size: 15px; font-weight: 700; }
    .label { font-size: 12px; font-weight: 600; }
    .side { font-size: 11px; fill: ${COLORS.muted}; }
    .side.on { fill: ${COLORS.accent}; font-weight: 700; }
    .evidence { font-size: 11px; fill: ${COLORS.muted}; }
    .footer { font-size: 10px; fill: ${COLORS.muted}; }
  </style>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  ${body}
</svg>`
}

export function renderCard(result: MbtiResult): string {
  const title = `${escapeXml(result.login)}의 깃허브 MBTI`
  const barX = 150
  const barWidth = WIDTH - barX - PADDING - 90
  const top = 118

  const rows = result.axes.map((axis, i) => {
    const y = top + i * 40
    const leftOn = axis.letter === axis.left.letter
    const fill = Math.max(0, Math.min(1, axis.score)) * barWidth
    return [
      `<text x="${PADDING}" y="${y + 9}" class="label">${escapeXml(axis.label)}</text>`,
      `<text x="${barX - 8}" y="${y + 9}" class="side${leftOn ? ' on' : ''}" text-anchor="end">${escapeXml(axis.left.name)}</text>`,
      `<rect x="${barX}" y="${y}" width="${barWidth}" height="10" rx="5" fill="${COLORS.track}"/>`,
      `<rect x="${barX}" y="${y}" width="${fill.toFixed(1)}" height="10" rx="5" fill="${COLORS.accent}"/>`,
      `<text x="${barX + barWidth + 8}" y="${y + 9}" class="side${leftOn ? '' : ' on'}">${escapeXml(axis.right.name)}</text>`,
      `<text x="${barX}" y="${y + 24}" class="evidence">${escapeXml(axis.evidence)}</text>`,
    ].join('\n  ')
  })

  const height = top + result.axes.length * 40 + 24
  const body = [
    `<text x="${PADDING}" y="32" class="title">${title}</text>`,
    `<text x="${PADDING}" y="76" class="type">${escapeXml(result.type)}</text>`,
    `<text x="${PADDING}" y="98" class="nickname">${escapeXml(result.nickname)}</text>`,
    ...rows,
    `<text x="${WIDTH - PADDING}" y="${height - 12}" class="footer" text-anchor="end">*최근 1년 공개 커밋 기준 · ${escapeXml(result.timeZone)}</text>`,
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
