export const GOOGLE_CHAT_MAX_MESSAGE_BYTES = 32_000

export interface GoogleChatCreateMessageInput {
  accessToken: string
  spaceName: string
  text: string
  threadName?: string
  requestId?: string
}

export interface GoogleChatMessageClient {
  createMessage(input: GoogleChatCreateMessageInput): Promise<unknown>
}

export class GoogleChatApiClient implements GoogleChatMessageClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: {
    baseUrl?: string
    fetchImpl?: typeof fetch
  } = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://chat.googleapis.com/v1').replace(/\/+$/u, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async createMessage(input: GoogleChatCreateMessageInput): Promise<unknown> {
    if (!input.spaceName.startsWith('spaces/')) {
      throw new Error('Google Chat outbound space must be a spaces/{space} resource name')
    }
    const url = new URL(`${this.baseUrl}/${input.spaceName}/messages`)
    if (input.threadName) {
      url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD')
    }
    if (input.requestId) {
      url.searchParams.set('requestId', input.requestId)
    }

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: input.text,
        ...(input.threadName ? { thread: { name: input.threadName } } : {}),
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Google Chat spaces.messages.create failed: ${response.status} ${text}`.trim())
    }
    const text = await response.text()
    if (!text.trim()) {
      return {}
    }
    return JSON.parse(text) as unknown
  }
}

export function chunkGoogleChatText(
  text: string,
  maxBytes: number = GOOGLE_CHAT_MAX_MESSAGE_BYTES,
): string[] {
  const normalizedMax = Math.max(1, Math.min(Math.trunc(maxBytes), GOOGLE_CHAT_MAX_MESSAGE_BYTES))
  if (!text.trim()) {
    return []
  }
  const chunks: string[] = []
  let current = ''
  for (const char of text) {
    const next = `${current}${char}`
    if (Buffer.byteLength(next, 'utf8') <= normalizedMax || current.length === 0) {
      current = next
      continue
    }
    chunks.push(current)
    current = char
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}
