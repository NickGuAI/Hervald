import { describe, expect, it } from 'vitest'

import {
  MAX_MESSAGE_IMAGE_B64_LEN,
  MAX_MESSAGE_IMAGE_BYTES,
  MAX_MESSAGE_IMAGE_COUNT,
  MAX_MESSAGE_IMAGE_SIZE_MB,
  parseMessageImagesForRequest,
} from '../message-images'

describe('parseMessageImagesForRequest', () => {
  it('uses a 30 MB decoded image limit', () => {
    expect(MAX_MESSAGE_IMAGE_SIZE_MB).toBe(30)
    expect(MAX_MESSAGE_IMAGE_BYTES).toBe(30 * 1024 * 1024)
  })

  it('accepts supported image payloads', () => {
    const image = { mediaType: 'image/png', data: 'base64-data' }

    expect(parseMessageImagesForRequest([image])).toEqual({
      ok: true,
      images: [image],
    })
  })

  it('rejects unsupported media types without silently dropping the image', () => {
    expect(parseMessageImagesForRequest([{ mediaType: 'image/svg+xml', data: 'abc' }])).toEqual({
      ok: false,
      status: 400,
      error: 'Unsupported image type. Use PNG, JPEG, GIF, or WebP.',
    })
  })

  it('rejects too many images without truncating the payload', () => {
    const images = Array.from({ length: MAX_MESSAGE_IMAGE_COUNT + 1 }, () => ({
      mediaType: 'image/png',
      data: 'abc',
    }))

    expect(parseMessageImagesForRequest(images)).toEqual({
      ok: false,
      status: 413,
      error: `At most ${MAX_MESSAGE_IMAGE_COUNT} images can be sent at once`,
    })
  })

  it('rejects oversized image data before provider delivery', () => {
    expect(parseMessageImagesForRequest([{
      mediaType: 'image/png',
      data: 'a'.repeat(MAX_MESSAGE_IMAGE_B64_LEN + 1),
    }])).toEqual({
      ok: false,
      status: 413,
      error: 'Image is too large. Maximum size is 30 MB per image.',
    })
  })
})
