import { createHash, timingSafeEqual } from 'node:crypto'

function digestToken(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function secureTokenEqual(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const normalizedProvided = provided?.trim()
  const normalizedExpected = expected?.trim()
  if (!normalizedProvided || !normalizedExpected) {
    return false
  }

  return timingSafeEqual(
    digestToken(normalizedProvided),
    digestToken(normalizedExpected),
  )
}
