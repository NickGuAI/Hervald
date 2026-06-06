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

function getBlockFromMarker(marker: string): string {
  const startIndex = css.indexOf(marker)
  if (startIndex === -1) {
    throw new Error(`Missing CSS marker: ${marker}`)
  }
  const bodyStart = css.indexOf('{', startIndex) + 1
  const bodyEnd = css.indexOf('\n  }', bodyStart)
  if (bodyStart === 0 || bodyEnd === -1) {
    throw new Error(`Unterminated CSS block for marker: ${marker}`)
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

  it('keeps markdown emphasis readable by inheriting Sumi-e chat foreground tokens', () => {
    const overlayStrongBlock = getBlockFromMarker('.session-view-overlay .msg-agent strong,')
    const hervaldStrongBlock = getBlockFromMarker('.hervald-chat-pane .msg-agent-md strong,')

    expect(overlayStrongBlock).toContain('font-weight: 500;')
    expect(overlayStrongBlock).toContain('color: var(--msg-text);')
    expect(hervaldStrongBlock).toContain('font-weight: 500;')
    expect(hervaldStrongBlock).toContain('color: currentColor;')
    expect(css).not.toContain('#f0ede5')
    expect(css).not.toContain('font-weight: 600;')
  })

  it('keeps user chat bubbles inside a definite wide column', () => {
    const userStackBlock = getBlock('.hervald-chat-pane .msg-user-stack')
    const userBubbleBlock = getBlock('.hervald-chat-pane .msg-user')

    expect(userStackBlock).toContain('width: 85%;')
    expect(userStackBlock).toContain('min-width: 0;')
    expect(userBubbleBlock).toContain('width: fit-content;')
    expect(userBubbleBlock).toContain('max-width: 100%;')
    expect(userBubbleBlock).not.toContain('max-width: min(62%, 100%);')
  })
})
