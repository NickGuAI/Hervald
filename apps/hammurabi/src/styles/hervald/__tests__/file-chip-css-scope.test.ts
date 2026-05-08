import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const cssPath = path.resolve(moduleDir, '../../../index.css')
const previewPath = path.resolve(
  moduleDir,
  '../../../../modules/workspace/components/WorkspaceFilePreview.tsx',
)

const cssContent = readFileSync(cssPath, 'utf8')
const previewContent = readFileSync(previewPath, 'utf8')

describe('file-chip CSS scope guardrail (issue #1188)', () => {
  it('declares .file-chip and .file-chip-remove at the global scope so the chip is visible on desktop Hervald', () => {
    expect(cssContent).toMatch(/^\s*\.file-chip\s*\{/m)
    expect(cssContent).toMatch(/^\s*\.file-chip-remove\s*\{/m)
  })

  it('does not re-scope chip rules under any ancestor selector (the chip lives in both mobile and desktop containers)', () => {
    expect(cssContent).not.toMatch(/\.[a-zA-Z_][\w-]*\s+\.file-chip\b/)
    expect(cssContent).not.toMatch(/\.[a-zA-Z_][\w-]*\s+\.file-chip-remove\b/)
  })

  it('renders the trigger button with the operator-facing "Add to context" label', () => {
    expect(previewContent).toContain('Add to context')
    expect(previewContent).not.toContain('Insert Path')
  })
})
