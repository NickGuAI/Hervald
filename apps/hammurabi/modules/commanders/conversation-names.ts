const ADJECTIVES = [
  'amber',
  'ancient',
  'autumn',
  'blue',
  'bold',
  'brisk',
  'bright',
  'calm',
  'cedar',
  'clear',
  'cobalt',
  'cool',
  'crimson',
  'daring',
  'deep',
  'ember',
  'evening',
  'faded',
  'gentle',
  'golden',
  'granite',
  'green',
  'hidden',
  'hollow',
  'iron',
  'ivory',
  'jade',
  'keen',
  'kind',
  'lively',
  'lone',
  'lunar',
  'maple',
  'mellow',
  'midnight',
  'misty',
  'narrow',
  'noble',
  'north',
  'oak',
  'opal',
  'patient',
  'quiet',
  'rapid',
  'red',
  'river',
  'royal',
  'sable',
  'sage',
  'scarlet',
  'sharp',
  'silent',
  'silver',
  'solar',
  'steady',
  'stone',
  'storm',
  'swift',
  'tawny',
  'velvet',
  'verdant',
  'warm',
  'wild',
  'winter',
] as const

const NOUNS = [
  'anchor',
  'arrow',
  'badger',
  'bay',
  'bear',
  'beacon',
  'bird',
  'bridge',
  'brook',
  'canyon',
  'cliff',
  'cloud',
  'comet',
  'cove',
  'creek',
  'crow',
  'dawn',
  'delta',
  'dune',
  'falcon',
  'field',
  'fire',
  'fjord',
  'forest',
  'forge',
  'fox',
  'garden',
  'gate',
  'glade',
  'harbor',
  'hawk',
  'hill',
  'isle',
  'lake',
  'leaf',
  'meadow',
  'mesa',
  'moon',
  'mountain',
  'ocean',
  'owl',
  'peak',
  'pine',
  'prairie',
  'quartz',
  'raven',
  'reef',
  'ridge',
  'river',
  'rook',
  'shore',
  'sparrow',
  'spring',
  'star',
  'stone',
  'summit',
  'thunder',
  'trail',
  'valley',
  'wave',
  'willow',
  'wind',
  'wolf',
] as const

const MIN_CONVERSATION_NAME_LENGTH = 1
const MAX_CONVERSATION_NAME_LENGTH = 64
const MAX_GENERATION_ATTEMPTS = ADJECTIVES.length * NOUNS.length

function normalizeForComparison(name: string): string {
  return name.trim().toLowerCase()
}

function buildNameSet(names: Iterable<string>): Set<string> {
  const normalized = new Set<string>()
  for (const name of names) {
    const parsed = normalizeConversationName(name)
    if (parsed) {
      normalized.add(normalizeForComparison(parsed))
    }
  }
  return normalized
}

function formatSuffix(value: number): string {
  return String(value).padStart(2, '0')
}

export function normalizeConversationName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (
    trimmed.length < MIN_CONVERSATION_NAME_LENGTH
    || trimmed.length > MAX_CONVERSATION_NAME_LENGTH
  ) {
    return null
  }

  return trimmed
}

export function conversationNamesEqual(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right)
}

export function hasConversationNameCollision(
  existingNames: Iterable<string>,
  candidate: string,
): boolean {
  return buildNameSet(existingNames).has(normalizeForComparison(candidate))
}

export function generateConversationName(
  existingNames: Iterable<string>,
  random: () => number = Math.random,
): string {
  const used = buildNameSet(existingNames)

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(random() * NOUNS.length)]
    if (!adjective || !noun) {
      continue
    }

    const base = `${adjective}-${noun}`
    if (!used.has(normalizeForComparison(base))) {
      return base
    }

    const candidate = `${base}-${formatSuffix((attempt % 99) + 1)}`
    if (!used.has(normalizeForComparison(candidate))) {
      return candidate
    }
  }

  let suffix = 1
  while (suffix < 10_000) {
    const fallback = `chat-${formatSuffix(suffix)}`
    if (!used.has(normalizeForComparison(fallback))) {
      return fallback
    }
    suffix += 1
  }

  throw new Error('Unable to generate a unique conversation name')
}
