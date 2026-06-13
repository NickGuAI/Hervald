import type { QueuedMessageImage } from './message-queue.js'

export const ALLOWED_MESSAGE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const MAX_MESSAGE_IMAGE_SIZE_MB = 30
export const MAX_MESSAGE_IMAGE_BYTES = MAX_MESSAGE_IMAGE_SIZE_MB * 1024 * 1024
export const MAX_MESSAGE_IMAGE_B64_LEN = Math.ceil(MAX_MESSAGE_IMAGE_BYTES / 3) * 4
export const MAX_MESSAGE_IMAGE_COUNT = 5
export const MAX_MESSAGE_IMAGES_TOTAL_B64_LEN = MAX_MESSAGE_IMAGE_COUNT * MAX_MESSAGE_IMAGE_B64_LEN
export const MESSAGE_IMAGE_TRANSPORT_LIMIT_MB = 240
export const MESSAGE_IMAGE_JSON_BODY_LIMIT = `${MESSAGE_IMAGE_TRANSPORT_LIMIT_MB}mb`
export const MESSAGE_IMAGE_WEBSOCKET_MAX_PAYLOAD_BYTES = MESSAGE_IMAGE_TRANSPORT_LIMIT_MB * 1024 * 1024

export type MessageImagesParseResult =
  | { ok: true; images: QueuedMessageImage[] }
  | { ok: false; status: 400 | 413; error: string }

export function parseMessageImagesForRequest(value: unknown): MessageImagesParseResult {
  if (value === undefined) {
    return { ok: true, images: [] }
  }
  if (!Array.isArray(value)) {
    return { ok: false, status: 400, error: 'images must be an array' }
  }
  if (value.length > MAX_MESSAGE_IMAGE_COUNT) {
    return { ok: false, status: 413, error: `At most ${MAX_MESSAGE_IMAGE_COUNT} images can be sent at once` }
  }

  const images: QueuedMessageImage[] = []
  let totalBase64Length = 0

  for (const image of value) {
    if (image === null || typeof image !== 'object') {
      return { ok: false, status: 400, error: 'Each image must include mediaType and data' }
    }
    const mediaType = (image as { mediaType?: unknown }).mediaType
    const data = (image as { data?: unknown }).data
    if (typeof mediaType !== 'string' || !ALLOWED_MESSAGE_IMAGE_TYPES.has(mediaType)) {
      return { ok: false, status: 400, error: 'Unsupported image type. Use PNG, JPEG, GIF, or WebP.' }
    }
    if (typeof data !== 'string' || data.length === 0) {
      return { ok: false, status: 400, error: 'Each image must include base64 data' }
    }
    if (data.length > MAX_MESSAGE_IMAGE_B64_LEN) {
      return { ok: false, status: 413, error: `Image is too large. Maximum size is ${MAX_MESSAGE_IMAGE_SIZE_MB} MB per image.` }
    }
    totalBase64Length += data.length
    if (totalBase64Length > MAX_MESSAGE_IMAGES_TOTAL_B64_LEN) {
      return { ok: false, status: 413, error: 'Image payload is too large' }
    }
    images.push({ mediaType, data })
  }

  return { ok: true, images }
}
