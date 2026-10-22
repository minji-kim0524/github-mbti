import type { MbtiResult } from './analyze.js'
import { ICONS } from './icons.js'

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

const WIDTH = 700
const PADDING = 24
// README 이미지는 웹폰트를 불러올 수 없으므로 시스템 폰트로 대체된다
const FONT = `Pretendard, -apple-system, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif`

// 가로 배치: 왼쪽 1/3 은 캐릭터 이미지, 오른쪽 2/3 은 축별 막대
const COLUMN_GAP = 24
const LEFT_WIDTH = Math.round((WIDTH - PADDING * 2) / 3)
const BAR_X = PADDING + LEFT_WIDTH + COLUMN_GAP
const BAR_WIDTH = WIDTH - PADDING - BAR_X
/** 막대 두께와, 막대 양옆 비율 글자가 차지하는 폭(px, "100%" + 여백) */
const BAR_HEIGHT = 10
const RATE_WIDTH = 46
/** 왼쪽 2x2 아이콘 한 칸의 크기와 칸 사이 간격(px) */
const ICON_SIZE = 84
const ICON_GAP = 12

// 어두운 배경 위에 유리 효과 아이콘을 올리는 테마
const COLORS = {
  background: '#353535',
  border: '#4a4a4a',
  text: '#f2f2f2',
  muted: '#a9a9a9',
  track: '#4a4a4a',
}

// 축별 막대 색. 어두운 배경에서 잘 보이도록 밝은 톤을 쓰고, 서로 색상(hue)이 겹치지 않게 고른다
const AXIS_COLORS: Record<MbtiResult['axes'][number]['key'], string> = {
  time: '#b197fc',
  rhythm: '#63e6be',
  scope: '#ffd43b',
  collab: '#74c0fc',
}

function frame(height: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <style>
    text { font-family: ${FONT}; fill: ${COLORS.text}; }
    .title { font-size: 14px; font-weight: 600; fill: ${COLORS.muted}; }
    .nickname { font-size: 18px; font-weight: 700; }
    .side { font-size: 12px; fill: ${COLORS.muted}; }
    .side.on { font-weight: 700; }
    .rate { font-size: 13px; font-weight: 700; fill: ${COLORS.muted}; }
    .criterion { font-size: 12px; font-weight: 600; }
    .footer { font-size: 10px; fill: ${COLORS.muted}; }
    .glass { fill: url(#glass-fill); stroke: url(#glass-stroke); stroke-width: 1.5; }
  </style>
  <defs>
    <!-- 유리 효과: 반투명 흰 면 + 대각선 양 끝이 밝은 테두리 -->
    <linearGradient id="glass-fill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>
    <linearGradient id="glass-stroke" x1="0.9" y1="0" x2="0.1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="0.6" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  ${body}
</svg>`
}

export function renderCard(result: MbtiResult): string {
  // 카드에 유형 글자를 따로 쓰지 않으므로 화면 낭독기용 제목에 유형을 넣어 둔다
  const title = `${escapeXml(result.login)}의 깃허브 MBTI: ${escapeXml(result.type)}`
  const top = 36
  const rowHeight = 72

  // 한 축은 세 줄: 위 가운데에 판정 기준, 가운데에 비율 · 막대 · 비율, 아래 양 끝에 성향 이름.
  // 비율과 이름은 양 끝에서 세로로 맞추고, 막대는 두 비율 사이에 그린다.
  // 막대 색은 축마다 다르게 하고, 판정된 쪽 비율·이름도 같은 색으로 강조한다.
  const trackX = BAR_X + RATE_WIDTH
  const trackWidth = BAR_WIDTH - RATE_WIDTH * 2
  const rows = result.axes.map((axis, i) => {
    const y = top + i * rowHeight
    const barY = y + 12
    const color = AXIS_COLORS[axis.key]
    const leftOn = axis.letter === axis.left.letter
    const leftShare = Math.max(0, Math.min(1, axis.score))
    // 막대는 판정된 쪽 끝부터 그쪽 비율만큼 채운다
    const share = leftOn ? leftShare : 1 - leftShare
    const fill = share * trackWidth
    const fillX = leftOn ? trackX : trackX + trackWidth - fill
    const percent = (value: number) => (axis.insufficient ? '-' : `${Math.round(value * 100)}%`)
    const side = (s: { letter: string; name: string }, value: number, on: boolean, end: 'left' | 'right') => {
      const x = end === 'left' ? BAR_X : BAR_X + BAR_WIDTH
      const anchor = end === 'right' ? ' text-anchor="end"' : ''
      const highlight = on ? ` style="fill: ${color}"` : ''
      return [
        // 비율 글자의 세로 가운데를 막대 가운데에 맞춘다
        `<text x="${x}" y="${barY + BAR_HEIGHT / 2 + 5}"${anchor} class="rate"${highlight}>${percent(value)}</text>`,
        `<text x="${x}" y="${barY + 30}"${anchor} class="side${on ? ' on' : ''}"${highlight}>${escapeXml(`${s.name}(${s.letter})`)}</text>`,
      ].join('\n  ')
    }
    const criterion = axis.insufficient ? `${axis.criterion} · 데이터 부족` : axis.criterion
    return [
      `<text x="${BAR_X + BAR_WIDTH / 2}" y="${y}" class="criterion" text-anchor="middle">${escapeXml(criterion)}</text>`,
      // 채운 막대는 둥근 트랙 모양으로 잘라, 바깥 끝만 둥글고 채움이 끝나는 쪽은 각지게 한다
      `<clipPath id="track-${i}"><rect x="${trackX}" y="${barY}" width="${trackWidth}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}"/></clipPath>`,
      `<rect x="${trackX}" y="${barY}" width="${trackWidth}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="${COLORS.track}"/>`,
      `<rect x="${fillX.toFixed(1)}" y="${barY}" width="${fill.toFixed(1)}" height="${BAR_HEIGHT}" fill="${color}" clip-path="url(#track-${i})"/>`,
      side(axis.left, leftShare, leftOn, 'left'),
      side(axis.right, 1 - leftShare, !leftOn, 'right'),
    ].join('\n  ')
  })

  // 막대 영역: 첫 기준 문구 윗선 ~ 마지막 이름 줄 아랫선
  const rowsTop = top - 10
  const rowsBottom = top + (result.axes.length - 1) * rowHeight + 46
  const height = rowsBottom + 32
  const centerX = PADDING + LEFT_WIDTH / 2
  // 아이콘 묶음은 막대 영역의 세로 가운데에 맞춘다
  const centerY = (rowsTop + rowsBottom) / 2
  // 판정된 글자 아이콘을 축 순서대로 2x2 로 배치한다 (시간 · 리듬 / 범위 · 협업)
  const gridSize = ICON_SIZE * 2 + ICON_GAP
  const icons = result.axes.map((axis, i) => {
    const x = centerX - gridSize / 2 + (i % 2) * (ICON_SIZE + ICON_GAP)
    const y = centerY - gridSize / 2 + Math.floor(i / 2) * (ICON_SIZE + ICON_GAP)
    const r = ICON_SIZE / 2
    return [
      `<circle cx="${x + r}" cy="${y + r}" r="${r - 1}" class="glass"/>`,
      `<svg x="${x}" y="${y}" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 50 50" fill="none">${ICONS[axis.letter] ?? ''}</svg>`,
    ].join('\n  ')
  })
  const timeZoneNote = result.timeZoneAutoDetected ? `시간대 자동 감지 (${result.timeZone})` : result.timeZone
  const body = [
    ...icons,
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
