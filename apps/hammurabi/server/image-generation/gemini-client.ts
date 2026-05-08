const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview'
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`

interface GeminiErrorPayload {
  error?: {
    code?: unknown
    message?: unknown
    status?: unknown
  }
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          mimeType?: unknown
          data?: unknown
        }
        inline_data?: {
          mime_type?: unknown
          data?: unknown
        }
      }>
    }
  }>
}

export interface GeminiImageGenerationOptions {
  apiKey: string
  prompt: string
  aspectRatio?: '1:1' | '16:9' | '9:16'
  fetchImpl?: typeof fetch
}

export class GeminiImageGenerationError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GeminiImageGenerationError'
    this.status = status
  }
}

function sanitizeGeminiErrorMessage(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[redacted-api-key]')
    .replace(/\s+/g, ' ')
    .trim()
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function extractImageData(payload: GeminiGenerateContentResponse): string | null {
  const parts = payload.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const camelInlineData = part.inlineData
    const snakeInlineData = part.inline_data
    const mimeType = typeof camelInlineData?.mimeType === 'string'
      ? camelInlineData.mimeType
      : typeof snakeInlineData?.mime_type === 'string'
        ? snakeInlineData.mime_type
        : undefined
    const base64Data = typeof camelInlineData?.data === 'string'
      ? camelInlineData.data
      : typeof snakeInlineData?.data === 'string'
        ? snakeInlineData.data
        : null
    if (typeof base64Data === 'string' && base64Data.length > 0) {
      if (mimeType !== undefined && typeof mimeType === 'string' && !mimeType.startsWith('image/')) {
        continue
      }
      return base64Data
    }
  }

  return null
}

export async function generateGeminiImage(
  options: GeminiImageGenerationOptions,
): Promise<Buffer> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(GEMINI_IMAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': options.apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: options.prompt,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['Image'],
        imageConfig: {
          aspectRatio: options.aspectRatio ?? '1:1',
        },
      },
    }),
  })

  if (!response.ok) {
    let message = `Gemini image generation failed (${response.status})`
    const rawBody = await response.text()
    try {
      const payload = JSON.parse(rawBody) as GeminiErrorPayload
      const detail = toNonEmptyString(payload.error?.message)
      if (detail) {
        message = `Gemini image generation failed (${response.status}): ${sanitizeGeminiErrorMessage(detail)}`
      }
    } catch {
      const detail = sanitizeGeminiErrorMessage(rawBody)
      if (detail) {
        message = `Gemini image generation failed (${response.status}): ${detail}`
      }
    }

    throw new GeminiImageGenerationError(response.status, message)
  }

  const payload = (await response.json()) as GeminiGenerateContentResponse
  const base64Image = extractImageData(payload)
  if (!base64Image) {
    throw new GeminiImageGenerationError(
      502,
      'Gemini image generation failed: response did not include image bytes',
    )
  }

  return Buffer.from(base64Image, 'base64')
}
