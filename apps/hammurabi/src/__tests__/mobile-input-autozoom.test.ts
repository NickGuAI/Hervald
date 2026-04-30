import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * iOS Safari auto-zooms any form control whose computed font-size is below
 * 16px on focus. This file has been flagged in the past because the Hervald
 * composer was 13.5px, which triggered unwanted zoom on iPhone.
 *
 * These tests assert the CSS text contains both safety nets:
 * 1. A general `@media (max-width: 767px)` rule that sets form controls to
 *    16px in the base layer.
 * 2. A composer-specific `@media (max-width: 767px)` override that lifts the
 *    Hervald composer input from its desktop-density 13.5px to 16px.
 *
 * If either rule is removed, the iPhone autozoom regression will reappear.
 */
describe('iOS mobile input autozoom prevention (index.css)', () => {
  const cssPath = join(__dirname, '../index.css')
  const css = readFileSync(cssPath, 'utf8')

  it('keeps the Hervald composer at 16px on mobile viewports', () => {
    // The desktop rule is 13.5px (tight Hervald density). Mobile override
    // must lift it to 16px under a max-width: 767px media query.
    const mobileOverride =
      /@media\s*\(\s*max-width:\s*767px\s*\)\s*\{\s*\.hervald-session-composer\s+\.input-field\s*\{\s*font-size:\s*16px\s*;?\s*\}\s*\}/
    expect(css).toMatch(mobileOverride)
  })

  it('applies a 16px floor to all form controls on mobile as defence-in-depth', () => {
    // The base-layer rule targets input/textarea/select so future forms do
    // not fall below the autozoom floor by accident. Using a tolerant regex
    // that accepts property ordering / spacing variants.
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*767px\s*\)/)
    expect(css).toMatch(/input:not\(\[type=.checkbox.\]\)/)
    expect(css).toMatch(/textarea,\s*\n?\s*select\s*\{[^}]*font-size:\s*16px/s)
  })

  it('keeps the desktop Hervald composer density at 13.5px (not affected)', () => {
    // Regression guard: the mobile rule must NOT change the desktop size.
    // The bare `.hervald-session-composer .input-field { ... font-size: 13.5px; ... }`
    // rule (outside any media query) is the desktop contract.
    const desktopRule = /\.hervald-session-composer\s+\.input-field\s*\{[^}]*font-size:\s*13\.5px/s
    expect(css).toMatch(desktopRule)
  })
})
