const EXCERPT_LIMIT = 2_000

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractNamedSections(markdown: string, sectionNames: ReadonlySet<string>): string[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const sections: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index]?.match(/^(#{1,6})\s+(.*)$/)
    if (!headingMatch) {
      continue
    }

    const headingLevel = headingMatch[1].length
    const headingText = headingMatch[2].trim()
    if (!sectionNames.has(headingText.toLowerCase())) {
      continue
    }

    const collected: string[] = [lines[index] ?? '']
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeadingMatch = lines[cursor]?.match(/^(#{1,6})\s+(.*)$/)
      if (nextHeadingMatch && nextHeadingMatch[1].length <= headingLevel) {
        break
      }
      collected.push(lines[cursor] ?? '')
    }

    const normalized = normalizeWhitespace(collected.join('\n'))
    if (normalized) {
      sections.push(normalized)
    }
  }

  return sections
}

export function extractCommanderMdExcerpt(commanderMd: string): string {
  const normalized = normalizeWhitespace(commanderMd)
  if (!normalized) {
    return ''
  }

  const sections = extractNamedSections(normalized, new Set(['identity', 'mission']))
  const source = sections.length > 0 ? sections.join('\n\n') : normalized
  return source.slice(0, EXCERPT_LIMIT).trim()
}

export function buildSumiPortraitPrompt(input: {
  displayName: string
  commanderMdExcerpt: string
}): string {
  const displayName = normalizeWhitespace(input.displayName)
  const commanderMdExcerpt = normalizeWhitespace(input.commanderMdExcerpt)

  return [
    `Create a portrait of ${displayName}, a Hammurabi commander.`,
    'Style: sumi-e ink wash painting, monochrome black ink on washi paper, traditional Japanese minimalism, expressive single-stroke linework, subtle gradient washes, no color, square aspect ratio 1024×1024, portrait composition, no text or signature in image.',
    'Subject direction: one central figure only, chest-up portrait, calm authority, distinctive facial structure, strong silhouette, understated clothing, hands out of frame, uncluttered negative space.',
    'Persona cues from COMMANDER.md:',
    commanderMdExcerpt || 'No additional COMMANDER.md excerpt was available.',
    'Render the commander as a human portrait informed by the persona cues above. Avoid fantasy armor, modern UI overlays, symbols, captions, logos, and background clutter.',
  ].join('\n\n')
}
