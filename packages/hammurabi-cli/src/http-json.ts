export type FetchJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; response: Response }

function malformedJsonResponse(response: Response): Response {
  return new Response(
    JSON.stringify({
      error: `Malformed JSON response from Hammurabi API (HTTP ${response.status})`,
    }),
    {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    },
  )
}

export async function readJsonResponse(response: Response): Promise<FetchJsonResult> {
  if (!response.ok) {
    return { ok: false, response }
  }

  if (response.status === 204) {
    return { ok: true, data: null }
  }

  try {
    return { ok: true, data: (await response.json()) as unknown }
  } catch {
    return { ok: false, response: malformedJsonResponse(response) }
  }
}

export async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<FetchJsonResult> {
  return readJsonResponse(await fetchImpl(url, init))
}
