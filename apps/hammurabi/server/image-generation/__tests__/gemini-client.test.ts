import { describe, expect, it, vi } from 'vitest'
import {
  GeminiImageGenerationError,
  generateGeminiImage,
} from '../gemini-client'

describe('generateGeminiImage', () => {
  it('posts the expected model request and returns decoded image bytes', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: Buffer.from('png-binary').toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )

    const image = await generateGeminiImage({
      apiKey: 'AIza-test',
      prompt: 'Paint Atlas in sumi-e.',
      fetchImpl,
    })

    expect(image.toString()).toBe('png-binary')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    )
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': 'AIza-test',
    })

    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<{ text: string }> }>
      generationConfig: {
        responseModalities: string[]
        imageConfig: {
          aspectRatio: string
        }
      }
    }
    expect(body.contents[0]?.parts[0]?.text).toBe('Paint Atlas in sumi-e.')
    expect(body.generationConfig.responseModalities).toEqual(['Image'])
    expect(body.generationConfig.imageConfig).toEqual({
      aspectRatio: '1:1',
    })
  })

  it.each([
    [
      401,
      { error: { message: 'API key not valid. Please pass a valid API key.' } },
      'Gemini image generation failed (401): API key not valid. Please pass a valid API key.',
    ],
    [
      429,
      { error: { message: 'Rate limit exceeded for this model.' } },
      'Gemini image generation failed (429): Rate limit exceeded for this model.',
    ],
    [
      503,
      { error: { message: 'The model is temporarily unavailable.' } },
      'Gemini image generation failed (503): The model is temporarily unavailable.',
    ],
  ])('surfaces sanitized upstream errors for HTTP %s', async (status, payload, expectedMessage) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )

    await expect(() => generateGeminiImage({
      apiKey: 'AIza-test',
      prompt: 'Prompt',
      fetchImpl,
    })).rejects.toMatchObject({
      name: 'GeminiImageGenerationError',
      status,
      message: expectedMessage,
    } satisfies Partial<GeminiImageGenerationError>)
  })

  it('throws when the response does not include image bytes', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'No image here.' }],
            },
          },
        ],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )

    await expect(() => generateGeminiImage({
      apiKey: 'AIza-test',
      prompt: 'Prompt',
      fetchImpl,
    })).rejects.toMatchObject({
      name: 'GeminiImageGenerationError',
      status: 502,
      message: 'Gemini image generation failed: response did not include image bytes',
    } satisfies Partial<GeminiImageGenerationError>)
  })
})
