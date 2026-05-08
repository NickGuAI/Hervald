import { describe, expect, it } from 'vitest'
import {
  buildSumiPortraitPrompt,
  extractCommanderMdExcerpt,
} from '../sumi-portrait-prompt'

describe('sumi portrait prompt', () => {
  it('extracts Identity and Mission sections and builds a deterministic prompt', () => {
    const commanderMd = `
# Atlas

## Identity
Atlas is a rigorous engineering commander.
She prefers surgical edits, clear reasoning, and durable systems.

### Signals
- Focused
- Direct

## Core Lanes
Ignore this section for the excerpt.

## Mission
Own the feature work end-to-end.
Protect system integrity while moving quickly.

## Appendix
Out of scope.
`

    expect(extractCommanderMdExcerpt(commanderMd)).toMatchInlineSnapshot(`
      "## Identity
      Atlas is a rigorous engineering commander.
      She prefers surgical edits, clear reasoning, and durable systems.

      ### Signals
      - Focused
      - Direct

      ## Mission
      Own the feature work end-to-end.
      Protect system integrity while moving quickly."
    `)

    expect(buildSumiPortraitPrompt({
      displayName: 'Atlas',
      commanderMdExcerpt: extractCommanderMdExcerpt(commanderMd),
    })).toMatchInlineSnapshot(`
      "Create a portrait of Atlas, a Hammurabi commander.

      Style: sumi-e ink wash painting, monochrome black ink on washi paper, traditional Japanese minimalism, expressive single-stroke linework, subtle gradient washes, no color, square aspect ratio 1024×1024, portrait composition, no text or signature in image.

      Subject direction: one central figure only, chest-up portrait, calm authority, distinctive facial structure, strong silhouette, understated clothing, hands out of frame, uncluttered negative space.

      Persona cues from COMMANDER.md:

      ## Identity
      Atlas is a rigorous engineering commander.
      She prefers surgical edits, clear reasoning, and durable systems.

      ### Signals
      - Focused
      - Direct

      ## Mission
      Own the feature work end-to-end.
      Protect system integrity while moving quickly.

      Render the commander as a human portrait informed by the persona cues above. Avoid fantasy armor, modern UI overlays, symbols, captions, logos, and background clutter."
    `)
  })
})
