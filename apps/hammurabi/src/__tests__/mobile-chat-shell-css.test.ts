import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

function getBlock(selector: string): string {
  const marker = `${selector} {`
  const startIndex = css.indexOf(marker)
  if (startIndex === -1) {
    throw new Error(`Missing CSS block for ${selector}`)
  }
  const bodyStart = startIndex + marker.length
  const bodyEnd = css.indexOf('\n  }', bodyStart)
  if (bodyEnd === -1) {
    throw new Error(`Unterminated CSS block for ${selector}`)
  }
  return css.slice(bodyStart, bodyEnd)
}

describe('mobile chat shell CSS contracts', () => {
  it('uses column layout for the mobile session header so page dots stack below the action row', () => {
    const headerBlock = getBlock('.session-view-overlay .session-header')

    expect(headerBlock).toContain('display: flex;')
    expect(headerBlock).toContain('flex-direction: column;')
    expect(headerBlock).toContain('align-items: stretch;')
    expect(headerBlock).not.toContain('justify-content: space-between;')
  })

  it('keeps the mobile composer field stack as a flex row so the textarea can stretch full width', () => {
    const composerFieldBlock = getBlock('.hervald-session-composer .composer-field-stack')

    expect(composerFieldBlock).toContain('display: flex;')
    expect(composerFieldBlock).toContain('min-height: 40px;')
  })

  it('defines the light-theme token map for mobile session overlays', () => {
    const lightBlock = getBlock('.session-view-overlay.hv-light')

    expect(lightBlock).toContain('--msg-bg: var(--hv-bg);')
    expect(lightBlock).toContain('--msg-surface: var(--hv-bg-raised);')
    expect(lightBlock).toContain('--msg-surface-elevated: var(--hv-bg-raised);')
    expect(lightBlock).toContain('--msg-text: var(--hv-fg);')
    expect(lightBlock).toContain('--msg-text-secondary: var(--hv-fg-muted);')
    expect(lightBlock).toContain('--msg-text-muted: var(--hv-fg-faint);')
    expect(lightBlock).toContain('--msg-border: var(--hv-border-hair);')
    expect(lightBlock).toContain('--msg-border-subtle: var(--hv-border-soft);')

    expect(lightBlock).not.toContain('--msg-surface: var(--hv-bg);')
  })
})
