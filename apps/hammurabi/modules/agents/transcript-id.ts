let fallbackCounter = 0

export function createTranscriptId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  fallbackCounter += 1
  return [
    'transcript',
    Date.now().toString(36),
    fallbackCounter.toString(36),
    Math.random().toString(36).slice(2),
  ].join('-')
}
