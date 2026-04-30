function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function globToRegExp(pattern: string, options?: { caseSensitive?: boolean }): RegExp {
  let source = '^'

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      source += '.*'
      continue
    }
    if (character === '?') {
      source += '.'
      continue
    }
    source += escapeRegExp(character)
  }

  source += '$'
  return new RegExp(source, options?.caseSensitive ? '' : 'i')
}

export function matchesGlob(
  value: string | undefined,
  pattern: string,
  options?: { caseSensitive?: boolean },
): boolean {
  if (!value || pattern.trim().length === 0) {
    return false
  }
  return globToRegExp(pattern.trim(), options).test(value)
}

export function findFirstMatchingGlob(
  value: string | undefined,
  patterns: string[],
  options?: { caseSensitive?: boolean },
): string | null {
  if (!value) {
    return null
  }
  for (const pattern of patterns) {
    if (matchesGlob(value, pattern, options)) {
      return pattern
    }
  }
  return null
}
