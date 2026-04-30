#!/usr/bin/env node
import process from 'node:process'

const HOOK_TAG = '[hammurabi-approval-hook]'

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

  let response
  try {
    response = await fetch(`${defaultBaseUrl()}/api/approval/check`, {
      method: 'POST',
      headers,
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failClosed(`approval service unreachable (${message})`)
    return
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
    return
  }

  let responsePayload
  try {
    responsePayload = await response.json()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failClosed(`approval response was not valid JSON (${message})`)
    return
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
