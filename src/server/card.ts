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

const PADDING = 24
// README 이미지는 웹폰트를 불러올 수 없으므로 시스템 폰트로 대체된다
const FONT = `Pretendard, -apple-system, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif`

/** 막대 두께(= 잔디 칸 한 변)와 칸 사이 간격, 막대 양옆 비율 글자가 차지하는 폭(px, "100%" + 여백) */
const BAR_HEIGHT = 11
const CELL_GAP = 3
const RATE_WIDTH = 46
/** 아이콘 칸 사이 간격(px) */
const ICON_GAP = 12
/** 축 한 줄(기준 · 막대 · 이름)의 높이(px) */
const ROW_HEIGHT = 72
/** 왼쪽 위 제목 줄("이름's Github MBTI")이 차지하는 높이(px) */
const HEADING_HEIGHT = 34

/**
 * 카드 배치.
 * - wide: 가로 배치 (왼쪽 1/3 은 2x2 아이콘, 오른쪽 2/3 은 축별 막대). README 기본값
 * - compact: 좁은 화면용 세로 배치 (위에 아이콘 4개 한 줄, 아래에 막대). SVG 는 글자 배치를 다시 할 수 없어
 *   줄이기만 하면 글자가 읽을 수 없게 작아지므로, 모바일에서는 이 배치를 따로 쓴다
 */
export type CardLayout = 'wide' | 'compact'
export const CARD_LAYOUTS: readonly CardLayout[] = ['wide', 'compact']

// nameLength: 제목에 쓰는 이름의 최대 글자 수 (넘치면 말줄임). 한글처럼 넓은 글자도 카드 폭을 넘지 않게 잡았다
const LAYOUTS = {
  wide: { width: 600, iconSize: 84, iconColumns: 2, nameLength: 30 },
  compact: { width: 360, iconSize: 64, iconColumns: 4, nameLength: 16 },
} satisfies Record<CardLayout, { width: number; iconSize: number; iconColumns: number; nameLength: number }>

/**
 * 카드 색 테마. README 는 <img> 라 GitHub 테마를 따라가지 못하므로, 라이트/다크 카드를 따로 만들어
 * <picture> 의 prefers-color-scheme 으로 골라 쓰게 한다. 생략하면 light
 */
export type CardTheme = 'light' | 'dark'
export const CARD_THEMES: readonly CardTheme[] = ['light', 'dark']

type Palette = {
  background: string
  border: string
  text: string
  muted: string
  track: string
  /** 축별 막대 색. 판정 글자도 이 색으로 쓰므로 배경 대비 4.5:1 이상으로 고르고, 색상(hue)은 보라·초록·주황·파랑으로 고르게 벌린다 */
  axis: Record<MbtiResult['axes'][number]['key'], string>
  /** 아이콘 뒤 유리 원: 면 그라데이션 [시작, 끝] 과 테두리 색·양 끝/가운데 불투명도 */
  glassFill: [string, number, string, number]
  glassStroke: [string, number, number]
}

const THEMES: Record<CardTheme, Palette> = {
  light: {
    background: '#f8f9fa',
    border: '#d8dde3',
    text: '#24292f',
    muted: '#6e7781',
    track: '#d0d7de',
    axis: { time: '#6741d9', rhythm: '#087f5b', scope: '#c2410c', collab: '#1971c2' },
    glassFill: ['#ffffff', 0.95, '#eef1f5', 0.9],
    glassStroke: ['#8c959f', 0.3, 0.08],
  },
  // GitHub 다크 화면(#0d1117) 위에서 어울리도록 한 단계 밝은 면을 쓰고, 막대는 같은 색상의 밝은 톤으로 바꾼다
  dark: {
    background: '#161b22',
    border: '#30363d',
    text: '#e6edf3',
    muted: '#8b949e',
    track: '#424a53',
    axis: { time: '#b197fc', rhythm: '#63e6be', scope: '#ffa94d', collab: '#74c0fc' },
    glassFill: ['#ffffff', 0.16, '#ffffff', 0.05],
    glassStroke: ['#ffffff', 0.5, 0.08],
  },
}

function frame(width: number, height: number, title: string, body: string, colors: Palette): string {
  const [fillFrom, fillFromOpacity, fillTo, fillToOpacity] = colors.glassFill
  const [strokeColor, strokeEdge, strokeMiddle] = colors.glassStroke
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <style>
    text { font-family: ${FONT}; fill: ${colors.text}; }
    .title { font-size: 14px; font-weight: 600; fill: ${colors.muted}; }
    .heading { font-size: 15px; font-weight: 700; }
    .nickname { font-size: 18px; font-weight: 700; }
    .side { font-size: 12px; fill: ${colors.muted}; }
    .side.on { font-weight: 700; }
    .rate { font-size: 13px; font-weight: 700; fill: ${colors.muted}; }
    .criterion { font-size: 12px; font-weight: 600; }
    .footer { font-size: 10px; fill: ${colors.muted}; }
    .glass { fill: url(#glass-fill); stroke: url(#glass-stroke); stroke-width: 1.5; }
  </style>
  <defs>
    <!-- 유리 효과: 반투명 면 + 대각선 양 끝이 진한 테두리 -->
    <linearGradient id="glass-fill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${fillFrom}" stop-opacity="${fillFromOpacity}"/>
      <stop offset="1" stop-color="${fillTo}" stop-opacity="${fillToOpacity}"/>
    </linearGradient>
    <linearGradient id="glass-stroke" x1="0.9" y1="0" x2="0.1" y2="1">
      <stop offset="0" stop-color="${strokeColor}" stop-opacity="${strokeEdge}"/>
      <stop offset="0.4" stop-color="${strokeColor}" stop-opacity="${strokeMiddle}"/>
      <stop offset="0.6" stop-color="${strokeColor}" stop-opacity="${strokeMiddle}"/>
      <stop offset="1" stop-color="${strokeColor}" stop-opacity="${strokeEdge}"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${colors.background}" stroke="${colors.border}" stroke-width="1"/>
  ${body}
</svg>`
}

export function renderCard(result: MbtiResult, layout: CardLayout = 'wide', theme: CardTheme = 'light'): string {
  const colors = THEMES[theme]
  // 카드에 유형 글자를 따로 쓰지 않으므로 화면 낭독기용 제목에 유형을 넣어 둔다
  const title = `${escapeXml(result.login)}의 깃허브 MBTI: ${escapeXml(result.type)}`
  const { width, iconSize, iconColumns, nameLength } = LAYOUTS[layout]
  // 프로필 이름이 없으면 아이디를 쓰고, 너무 길면 줄인다 (글자 단위로 자르기 위해 Array.from 사용)
  const chars = Array.from(result.name?.trim() || result.login)
  const displayName = chars.length > nameLength ? `${chars.slice(0, nameLength - 1).join('')}…` : chars.join('')
  const iconRows = Math.ceil(result.axes.length / iconColumns)
  const gridWidth = iconSize * iconColumns + ICON_GAP * (iconColumns - 1)
  const gridHeight = iconSize * iconRows + ICON_GAP * (iconRows - 1)

  // wide 는 아이콘 오른쪽에, compact 는 아이콘 아래에 막대 영역을 둔다
  const leftWidth = Math.round((width - PADDING * 2) / 3)
  const barX = layout === 'wide' ? PADDING + leftWidth + PADDING : PADDING
  const barWidth = width - PADDING - barX
  // 제목 줄 아래부터 그린다
  const contentTop = PADDING + HEADING_HEIGHT
  const top = layout === 'wide' ? contentTop + 12 : contentTop + gridHeight + 40

  // 한 축은 세 줄: 위 가운데에 판정 기준, 가운데에 비율 · 막대 · 비율, 아래 양 끝에 성향 이름.
  // 비율과 이름은 양 끝에서 세로로 맞추고, 막대는 두 비율 사이에 그린다.
  // 막대 색은 축마다 다르게 하고, 판정된 쪽 비율·이름도 같은 색으로 강조한다.
  const trackX = barX + RATE_WIDTH
  const trackWidth = barWidth - RATE_WIDTH * 2
  // 막대는 GitHub 잔디처럼 작은 정사각형 칸을 이어 그린다. 칸 수는 트랙 폭에 맞추고 남는 폭은 양옆에 나눠 가운데 정렬한다
  const cellCount = Math.floor((trackWidth + CELL_GAP) / (BAR_HEIGHT + CELL_GAP))
  const cellsX = trackX + (trackWidth - (cellCount * (BAR_HEIGHT + CELL_GAP) - CELL_GAP)) / 2
  const rows = result.axes.map((axis, i) => {
    const y = top + i * ROW_HEIGHT
    const barY = y + 12
    const color = colors.axis[axis.key]
    const leftOn = axis.letter === axis.left.letter
    const leftShare = Math.max(0, Math.min(1, axis.score))
    // 막대는 판정된 쪽 끝부터 그쪽 비율만큼 칸을 채운다
    const share = leftOn ? leftShare : 1 - leftShare
    const filled = Math.round(share * cellCount)
    const percent = (value: number) => (axis.insufficient ? '-' : `${Math.round(value * 100)}%`)
    const side = (s: { letter: string; name: string }, value: number, on: boolean, end: 'left' | 'right') => {
      const x = end === 'left' ? barX : barX + barWidth
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
      `<text x="${barX + barWidth / 2}" y="${y}" class="criterion" text-anchor="middle">${escapeXml(criterion)}</text>`,
      ...Array.from({ length: cellCount }, (_, c) => {
        const on = leftOn ? c < filled : c >= cellCount - filled
        const x = cellsX + c * (BAR_HEIGHT + CELL_GAP)
        return `<rect x="${x.toFixed(1)}" y="${barY}" width="${BAR_HEIGHT}" height="${BAR_HEIGHT}" rx="2" fill="${on ? color : colors.track}"/>`
      }),
      side(axis.left, leftShare, leftOn, 'left'),
      side(axis.right, 1 - leftShare, !leftOn, 'right'),
    ].join('\n  ')
  })

  // 막대 영역: 첫 기준 문구 윗선 ~ 마지막 이름 줄 아랫선
  const rowsTop = top - 10
  const rowsBottom = top + (result.axes.length - 1) * ROW_HEIGHT + 46
  const height = rowsBottom + 32
  // wide 는 왼쪽 칸에서 막대 영역의 세로 가운데에, compact 는 제목 줄 아래 가운데에 아이콘 묶음을 둔다
  const gridX = layout === 'wide' ? PADDING + (leftWidth - gridWidth) / 2 : (width - gridWidth) / 2
  const gridY = layout === 'wide' ? (rowsTop + rowsBottom - gridHeight) / 2 : contentTop
  // 판정된 글자 아이콘을 축 순서대로 놓는다 (wide 는 2x2: 시간 · 리듬 / 범위 · 협업)
  const icons = result.axes.map((axis, i) => {
    const x = gridX + (i % iconColumns) * (iconSize + ICON_GAP)
    const y = gridY + Math.floor(i / iconColumns) * (iconSize + ICON_GAP)
    const r = iconSize / 2
    return [
      `<circle cx="${x + r}" cy="${y + r}" r="${r - 1}" class="glass"/>`,
      `<svg x="${x}" y="${y}" width="${iconSize}" height="${iconSize}" viewBox="0 0 50 50" fill="none">${ICONS[axis.letter] ?? ''}</svg>`,
    ].join('\n  ')
  })
  const timeZoneNote = result.timeZoneAutoDetected ? `시간대 자동 감지 (${result.timeZone})` : result.timeZone
  const body = [
    `<text x="${PADDING}" y="${PADDING + 14}" class="heading">${escapeXml(`${displayName}'s Github MBTI`)}</text>`,
    ...icons,
    ...rows,
    `<text x="${width - PADDING}" y="${height - 12}" class="footer" text-anchor="end">*최근 1년 공개 커밋 기준 · ${escapeXml(timeZoneNote)}</text>`,
  ].join('\n  ')

  return frame(width, height, title, body, colors)
}

export function renderErrorCard(message: string, theme: CardTheme = 'light'): string {
  const title = '깃허브 MBTI'
  return frame(
    LAYOUTS.wide.width,
    90,
    title,
    `<text x="${PADDING}" y="36" class="title">${title}</text>
  <text x="${PADDING}" y="62" class="nickname">${escapeXml(message)}</text>`,
    THEMES[theme],
  )
}
