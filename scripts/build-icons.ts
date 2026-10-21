// public/*.svg 아이콘을 카드에 넣을 수 있는 문자열 모듈(src/server/icons.ts)로 변환한다.
// README(camo)는 SVG 안의 외부 이미지를 불러오지 않으므로 아이콘 코드를 카드 SVG 안에 직접 넣어야 하고,
// Vercel Function 에서 런타임에 파일을 읽지 않도록 빌드 전에 모듈로 만들어 둔다.
// 사용법: 아이콘을 바꾼 뒤 `pnpm icons` 를 실행하고 생성된 파일을 함께 커밋한다.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const SOURCE_DIR = new URL('../public/', import.meta.url)
const OUTPUT = new URL('../src/server/icons.ts', import.meta.url)

function toInner(letter: string, svg: string): string {
  return (
    svg
      // 바깥 <svg> 태그는 카드에서 위치·크기를 정해 다시 감싸므로 벗겨 낸다
      .replace(/^\s*<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      // Figma 에서 함께 내보낸 반투명 배경 원은 카드에서 따로 그린다
      .replace(/<rect width="50" height="50" rx="25"[^>]*\/>\s*/, '')
      // 한 카드에 아이콘 4개가 함께 들어가므로 id 앞에 글자를 붙여 겹치지 않게 한다
      .replace(/id="([^"]+)"/g, `id="${letter}-$1"`)
      .replace(/url\(#([^)]+)\)/g, `url(#${letter}-$1)`)
      .trim()
  )
}

const entries = readdirSync(SOURCE_DIR)
  .filter((file) => /^[A-Z]\.svg$/.test(file))
  .sort()
  .map((file) => {
    const letter = file[0] as string
    const inner = toInner(letter, readFileSync(new URL(file, SOURCE_DIR), 'utf8'))
    return `  ${letter}: ${JSON.stringify(inner)},`
  })

writeFileSync(
  OUTPUT,
  `// 자동 생성 파일 — 직접 고치지 말고 public/*.svg 를 바꾼 뒤 \`pnpm icons\` 를 실행한다.
// 축 글자별 아이콘 (viewBox 0 0 50 50 기준의 내부 SVG 코드)
export const ICONS: Record<string, string> = {
${entries.join('\n')}
}
`,
)
console.log(`아이콘 ${entries.length}개 → src/server/icons.ts`)
