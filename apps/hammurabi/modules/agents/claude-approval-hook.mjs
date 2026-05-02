#!/usr/bin/env node
import process from 'node:process'

const HOOK_TAG = '[hammurabi-approval-hook]'
const DEFAULT_REVIEW_RETRY_AFTER_MS = 1_000
const DEFAULT_APPROVAL_DEADLINE_MS = 60 * 60 * 1_000

function emitPreToolUseDecision(decision, reason) {
  const hookSpecificOutput = {
    hookEventName: 'PreToolUse',
    permissionDecision: decision,
  }
  if (typeof reason === 'string' && reason.trim().length > 0) {
    hookSpecificOutput.permissionDecisionReason = reason.trim()
  }
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`)
  process.exit(0)
}

function failOpenEnabled() {
  return process.env.HAMMURABI_APPROVAL_FAIL_OPEN?.trim() === '1'
}

function failClosed(reason) {
  if (failOpenEnabled()) {
    process.stderr.write(`${HOOK_TAG} ${reason} — failing open (HAMMURABI_APPROVAL_FAIL_OPEN=1)\n`)
    emitPreToolUseDecision('allow', reason)
    return
  }
  process.stderr.write(`${HOOK_TAG} ${reason} — blocking by default\n`)
  process.exit(2)
}

function defaultBaseUrl() {
  const explicit = process.env.HAMMURABI_APPROVAL_BASE_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/, '')
  }
  const port = process.env.HAMMURABI_PORT?.trim() || '20001'
  return `http://127.0.0.1:${port}`
}

function normalizeRetryAfterMs(value) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REVIEW_RETRY_AFTER_MS
  }
  return Math.max(50, Math.min(Math.floor(parsed), 60_000))
}

function resolveApprovalDeadlineMs() {
  const raw = process.env.HAMMURABI_APPROVAL_DEADLINE_MS?.trim()
  if (!raw) {
    return DEFAULT_APPROVAL_DEADLINE_MS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_APPROVAL_DEADLINE_MS
  }
  return parsed
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchApprovalPayload(url, init, failureContext) {
  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failClosed(`${failureContext} (${message})`)
    return null
  }

  if (!response.ok) {
    let errorText = ''
    try {
      errorText = (await response.text()).trim()
    } catch {
      errorText = ''
    }
    const detail = errorText ? `: ${errorText}` : ''
    failClosed(`approval service returned HTTP ${response.status}${detail}`)
    return null
  }

  try {
    return await response.json()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failClosed(`approval response was not valid JSON (${message})`)
    return null
  }
}

async function pollForTerminalDecision(requestId, retryAfterMs, headers) {
  const deadlineMs = resolveApprovalDeadlineMs()
  const deadlineAt = Date.now() + deadlineMs
  let nextDelayMs = normalizeRetryAfterMs(retryAfterMs)

  while (true) {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) {
      failClosed(`approval review deadline exceeded after ${deadlineMs}ms (request ${requestId})`)
      return null
    }

    await sleep(Math.min(nextDelayMs, remainingMs))

    const payload = await fetchApprovalPayload(
      `${defaultBaseUrl()}/api/approval/check/${encodeURIComponent(requestId)}`,
      {
        method: 'GET',
        headers,
      },
      `approval polling failed for request ${requestId}`,
    )
    if (!payload) {
      return null
    }

    if (payload?.decision !== 'pending') {
      return payload
    }

    nextDelayMs = normalizeRetryAfterMs(payload?.retry_after_ms)
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const raw = await readStdin()
  if (!raw.trim()) {
    process.exit(0)
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = raw
  }

  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    process.env.HAMMURABI_SESSION_NAME &&
    typeof payload.hammurabi_session_name !== 'string'
  ) {
    payload.hammurabi_session_name = process.env.HAMMURABI_SESSION_NAME
  }

  const headers = {
    'content-type': 'application/json',
  }
  const internalToken = process.env.HAMMURABI_INTERNAL_TOKEN?.trim()
  if (internalToken) {
    headers['x-hammurabi-internal-token'] = internalToken
  }

  let responsePayload = await fetchApprovalPayload(
    `${defaultBaseUrl()}/api/approval/check`,
    {
      method: 'POST',
      headers,
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    },
    'approval service unreachable',
  )
  if (!responsePayload) {
    return
  }

  if (responsePayload?.decision === 'pending') {
    const requestId = typeof responsePayload.request_id === 'string'
      ? responsePayload.request_id.trim()
      : ''
    if (!requestId) {
      failClosed('approval service returned pending without request_id')
      return
    }

    responsePayload = await pollForTerminalDecision(
      requestId,
      responsePayload?.retry_after_ms,
      headers,
    )
    if (!responsePayload) {
      return
    }
  }

  const reason = typeof responsePayload?.reason === 'string' && responsePayload.reason.trim().length > 0
    ? responsePayload.reason.trim()
    : undefined

  if (responsePayload?.decision === 'allow') {
    emitPreToolUseDecision('allow', reason)
    return
  }

  process.stderr.write(`${reason ?? 'Action rejected by Hammurabi policy.'}\n`)
  process.exit(2)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  failClosed(`hook crashed (${message})`)
})
