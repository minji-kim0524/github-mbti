import { describe, expect, test } from '@jest/globals'
import { analyze } from '../src/server/analyze.js'
import { escapeXml, renderCard, renderErrorCard } from '../src/server/card.js'
import { makeActivity } from './fixtures.js'

describe('escapeXml', () => {
  test('XML 특수 문자 다섯 개를 엔티티로 바꾼다', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    )
  })

  test('XML 1.0 에서 허용되지 않는 제어 문자는 지우고 탭·줄바꿈은 남긴다', () => {
    expect(escapeXml('a\u0000b\u0008c\u001Fd\te\nf')).toBe('abcd\te\nf')
  })
})

describe('카드 렌더링', () => {
  // compact 카드는 이름을 16자에서 자르므로 그보다 짧은 이름으로 확인한다
  test('프로필 이름에 들어 있는 태그는 이스케이프되어 실행되지 않는다', () => {
    const result = analyze(makeActivity({ name: '<b>Tom&Jerry</b>' }))
    for (const layout of ['wide', 'compact'] as const) {
      const svg = renderCard(result, layout)
      expect(svg).not.toContain('<b>')
      expect(svg).toContain('&lt;b&gt;Tom&amp;Jerry&lt;/b&gt;')
    }
  })

  test('긴 이름은 잘라서 쓰되, 잘린 태그 조각도 이스케이프한다', () => {
    const svg = renderCard(analyze(makeActivity({ name: '<script>alert(1)</script>' })), 'compact')
    expect(svg).not.toContain('<script')
    // 16자 중 15자 + 말줄임표
    expect(svg).toContain('&lt;script&gt;alert(1…')
  })

  test('오류 카드 메시지도 이스케이프한다', () => {
    const svg = renderErrorCard('사용자 <img src=x onerror=alert(1)> 없음')
    expect(svg).not.toContain('<img')
    expect(svg).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  test('테마에 따라 다른 카드를 만든다', () => {
    const result = analyze(makeActivity())
    expect(renderCard(result, 'wide', 'dark')).not.toBe(renderCard(result, 'wide', 'light'))
  })
})
