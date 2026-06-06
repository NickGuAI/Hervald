import { randomUUID } from 'node:crypto'
import type { ActionPolicyGateResult } from '../../../policies/action-policy-gate.js'
import type { ProviderApprovalAdapter } from '../../../policies/provider-approval-adapter.js'
import {
  isTranscriptEnvelope,
  type TranscriptEnvelope,
} from '../../../../src/types/transcript-envelope.js'
import { readCodexRuntime } from '../../providers/provider-session-context.js'
import { asObject } from '../../session/state.js'
import type { StreamJsonEvent, StreamSession } from '../../types.js'
import { markCodexTurnHealthy } from './helpers.js'

type ToolAnswerMap = Record<string, string | string[]>

interface CodexMcpElicitationReplyDeps {
  appendEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastEvent(session: StreamSession, event: StreamJsonEvent): void
  schedulePersistedSessionsWrite(): void
  scheduleTurnWatchdog(session: StreamSession): void
}

export interface CodexMcpToolContext {
  toolCallId?: string
  server: string
  tool: string
  toolName: string
  toolInput?: unknown
}

export interface CodexMcpElicitationDetails {
  requestId: number
  threadId?: string
  toolId: string
  message: string
  requestedSchema?: unknown
  serverName?: string
  tool?: string
  mode?: string
  url?: string
}

export interface CodexMcpElicitationApprovalRawEvent {
  requestId: number
  threadId?: string
  toolCallId?: string
  toolName: string
  toolInput?: unknown
  requestedSchema?: unknown
  message: string
  serverName?: string
  tool?: string
  mode?: string
  replyDeps: CodexMcpElicitationReplyDeps
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function readElicitationObject(params: unknown): {
  payload: Record<string, unknown>
  requestParams: Record<string, unknown>
} {
  const payload = asObject(params) ?? {}
  const request = asObject(payload.request)
  const requestParams = asObject(request?.params) ?? asObject(payload.params) ?? payload
  return { payload, requestParams }
}

function readRequestedSchema(payload: Record<string, unknown>, requestParams: Record<string, unknown>): unknown {
  return requestParams.requestedSchema ??
    requestParams.requested_schema ??
    payload.requestedSchema ??
    payload.requested_schema
}

function readSchemaProperties(schema: unknown): Record<string, unknown> | null {
  return asObject(asObject(schema)?.properties)
}

export function hasCodexMcpElicitationSchemaFields(schema: unknown): boolean {
  return Object.keys(readSchemaProperties(schema) ?? {}).some((key) => key.trim().length > 0)
}

function firstSchemaField(schema: unknown): {
  name: string
  property: Record<string, unknown> | null
} | null {
  const record = asObject(schema)
  const properties = readSchemaProperties(schema)
  if (!properties) {
    return null
  }

  const required = Array.isArray(record?.required)
    ? record.required.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined
  const fieldName = required ?? Object.keys(properties).find((key) => key.trim().length > 0)
  if (!fieldName) {
    return null
  }

  return {
    name: fieldName,
    property: asObject(properties[fieldName]),
  }
}

function coerceElicitationValue(property: Record<string, unknown> | null, message: string | undefined): unknown {
  const type = typeof property?.type === 'string' ? property.type : 'string'
  const enumValues = Array.isArray(property?.enum) ? property.enum : []

  if (enumValues.length > 0) {
    if (message) {
      const matched = enumValues.find((value) => String(value) === message)
      if (matched !== undefined) {
        return matched
      }
    }
    return enumValues[0]
  }

  if (type === 'boolean') {
    if (!message) {
      return true
    }
    const normalized = message.trim().toLowerCase()
    return !['false', 'no', 'reject', 'rejected', 'decline', 'declined'].includes(normalized)
  }

  if (type === 'number' || type === 'integer') {
    const parsed = message ? Number(message) : Number.NaN
    if (Number.isFinite(parsed)) {
      return type === 'integer' ? Math.trunc(parsed) : parsed
    }
    return 0
  }

  return message ?? 'Approved'
}

export function buildCodexMcpElicitationAcceptContent(
  requestedSchema: unknown,
  message: string | undefined,
): Record<string, unknown> {
  const field = firstSchemaField(requestedSchema)
  if (!field) {
    return message ? { message } : {}
  }
  return {
    [field.name]: coerceElicitationValue(field.property, message),
  }
}

export function buildCodexMcpElicitationResult(
  details: Pick<CodexMcpElicitationDetails, 'requestId' | 'requestedSchema'>,
  decision: 'approve' | 'reject' | 'cancel',
  message?: string,
): { requestId: number; result: Record<string, unknown> } {
  if (decision === 'cancel') {
    return {
      requestId: details.requestId,
      result: { action: 'cancel' },
    }
  }

  if (decision === 'reject') {
    return {
      requestId: details.requestId,
      result: { action: 'decline' },
    }
  }

  const trimmedMessage = message?.trim()
  return {
    requestId: details.requestId,
    result: {
      action: 'accept',
      content: buildCodexMcpElicitationAcceptContent(details.requestedSchema, trimmedMessage || undefined),
    },
  }
}

function normalizeMcpToken(value: string): string {
  return value.trim().replace(/\s+/g, '_')
}

export function buildCodexMcpToolName(server: string, tool: string): string {
  return `mcp__${normalizeMcpToken(server)}__${normalizeMcpToken(tool)}`
}

function splitMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith('mcp__')) {
    return null
  }
  const stripped = toolName.slice(5)
  const separatorIndex = stripped.indexOf('__')
  if (separatorIndex === -1) {
    return null
  }
  const server = stripped.slice(0, separatorIndex).trim()
  const tool = stripped.slice(separatorIndex + 2).trim()
  return server && tool ? { server, tool } : null
}

function readStructuredToolContext(params: unknown): CodexMcpToolContext | null {
  const { payload, requestParams } = readElicitationObject(params)
  const meta = asObject(requestParams._meta) ?? asObject(payload._meta)
  const nestedToolParams = asObject(meta?.tool_params) ?? asObject(meta?.toolParams)
  const source = nestedToolParams ?? requestParams
  const server = readTrimmedString(source.mcp_server_name) ??
    readTrimmedString(source.mcpServerName) ??
    readTrimmedString(source.serverName) ??
    readTrimmedString(source.server) ??
    readTrimmedString(payload.mcp_server_name) ??
    readTrimmedString(payload.serverName) ??
    readTrimmedString(payload.server)
  const tool = readTrimmedString(source.toolName) ??
    readTrimmedString(source.tool) ??
    readTrimmedString(source.name) ??
    readTrimmedString(payload.toolName) ??
    readTrimmedString(payload.tool)
  if (!server || !tool) {
    return null
  }

  const toolInput = source.arguments ?? source.args ?? source.input ?? source.toolInput
  const toolCallId = readTrimmedString(source.toolCallId) ??
    readTrimmedString(source.toolUseId) ??
    readTrimmedString(source.toolId) ??
    readTrimmedString(source.itemId) ??
    readTrimmedString(payload.toolCallId) ??
    readTrimmedString(payload.toolId) ??
    readTrimmedString(payload.itemId)

  return {
    ...(toolCallId ? { toolCallId } : {}),
    server,
    tool,
    toolName: buildCodexMcpToolName(server, tool),
    ...(toolInput !== undefined ? { toolInput } : {}),
  }
}

export function readCodexMcpElicitationDetails(
  requestId: number,
  params: unknown,
  fallbackThreadId?: string,
): CodexMcpElicitationDetails {
  const { payload, requestParams } = readElicitationObject(params)
  const requestedSchema = readRequestedSchema(payload, requestParams)
  const message = readTrimmedString(requestParams.message) ??
    readTrimmedString(payload.message) ??
    readTrimmedString(requestParams.prompt) ??
    readTrimmedString(payload.prompt) ??
    readTrimmedString(requestParams.question) ??
    readTrimmedString(payload.question) ??
    'Codex requested user input through MCP elicitation.'
  const serverName = readTrimmedString(requestParams.mcp_server_name) ??
    readTrimmedString(payload.mcp_server_name) ??
    readTrimmedString(requestParams.serverName) ??
    readTrimmedString(payload.serverName) ??
    readTrimmedString(requestParams.server) ??
    readTrimmedString(payload.server)
  const tool = readTrimmedString(requestParams.toolName) ??
    readTrimmedString(payload.toolName) ??
    readTrimmedString(requestParams.tool) ??
    readTrimmedString(payload.tool)
  const toolId = readTrimmedString(requestParams.toolId) ??
    readTrimmedString(payload.toolId) ??
    readTrimmedString(requestParams.toolUseId) ??
    readTrimmedString(payload.toolUseId) ??
    readTrimmedString(requestParams.itemId) ??
    readTrimmedString(payload.itemId) ??
    `codex-mcp-elicitation-${requestId}`
  const threadId = readTrimmedString(requestParams.threadId) ??
    readTrimmedString(payload.threadId) ??
    fallbackThreadId

  return {
    requestId,
    ...(threadId ? { threadId } : {}),
    toolId,
    message,
    ...(requestedSchema !== undefined ? { requestedSchema } : {}),
    ...(serverName ? { serverName } : {}),
    ...(tool ? { tool } : {}),
    ...(readTrimmedString(requestParams.mode) ?? readTrimmedString(payload.mode)
      ? { mode: readTrimmedString(requestParams.mode) ?? readTrimmedString(payload.mode) }
      : {}),
    ...(readTrimmedString(requestParams.url) ?? readTrimmedString(payload.url)
      ? { url: readTrimmedString(requestParams.url) ?? readTrimmedString(payload.url) }
      : {}),
  }
}

export function findActiveCodexMcpToolContext(
  session: StreamSession,
  elicitationParams?: unknown,
): CodexMcpToolContext | null {
  const structured = readStructuredToolContext(elicitationParams)
  if (structured) {
    return structured
  }

  const endedToolCallIds = new Set<string>()
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    if (!isTranscriptEnvelope(event)) {
      continue
    }
    if (
      event.ev.type === 'tool.end'
      && typeof event.ev.toolCallId === 'string'
      && event.ev.toolCallId.trim().length > 0
    ) {
      endedToolCallIds.add(event.ev.toolCallId.trim())
      continue
    }
    if (event.ev.type !== 'tool.start') {
      continue
    }
    const toolCallId = event.ev.toolCallId.trim()
    if (endedToolCallIds.has(toolCallId)) {
      continue
    }
    const identity = splitMcpToolName(event.ev.name)
    if (!identity) {
      continue
    }
    return {
      toolCallId,
      server: identity.server,
      tool: identity.tool,
      toolName: event.ev.name,
      toolInput: event.ev.input,
    }
  }

  return null
}

function schemaQuestions(schema: unknown, fallbackQuestion: string): Array<Record<string, unknown>> {
  const properties = readSchemaProperties(schema)
  if (!properties || Object.keys(properties).length === 0) {
    return [{
      id: 'response',
      header: 'Response',
      question: fallbackQuestion,
      options: [],
      multiSelect: false,
    }]
  }

  return Object.entries(properties).map(([name, rawProperty]) => {
    const property = asObject(rawProperty)
    const enumValues = Array.isArray(property?.enum) ? property.enum : []
    const type = readTrimmedString(property?.type)
    const title = readTrimmedString(property?.title) ?? name
    const description = readTrimmedString(property?.description)
    const question = description ?? title
    const options = enumValues.length > 0
      ? enumValues.map((value) => ({ label: String(value), description: String(value) }))
      : type === 'boolean'
        ? [
            { label: 'Yes', description: 'Yes' },
            { label: 'No', description: 'No' },
          ]
        : undefined

    return {
      id: name,
      header: title,
      question,
      options: options ?? [],
      multiSelect: false,
    }
  })
}

export function buildCodexMcpElicitationQuestionEvent(
  details: CodexMcpElicitationDetails,
): TranscriptEnvelope {
  return {
    schemaVersion: 2,
    id: randomUUID(),
    time: new Date().toISOString(),
    source: {
      provider: 'codex',
      backend: 'rpc',
      rawEventType: 'mcpserver/elicitation/request',
      rawEventId: String(details.requestId),
      ...(details.threadId ? { sessionId: details.threadId } : {}),
    },
    itemId: details.toolId,
    ev: {
      type: 'approval.request',
      toolCallId: details.toolId,
      interactionKind: 'ask_user_question',
      prompt: details.message,
      questions: schemaQuestions(details.requestedSchema, details.message),
      request: {
        interactionKind: 'ask_user_question',
        toolName: 'Codex MCP Elicitation',
        providerContext: {
          provider: 'codex',
          backend: 'rpc',
          toolUseId: details.toolId,
          toolName: 'Codex MCP Elicitation',
          requestId: details.requestId,
          answerFormat: 'codex.mcp_elicitation',
          ...(details.requestedSchema !== undefined ? { requestedSchema: details.requestedSchema } : {}),
        },
      },
    },
  }
}

function readProviderContext(event: TranscriptEnvelope): Record<string, unknown> | null {
  if (event.ev.type !== 'approval.request') {
    return null
  }
  const request = asObject(event.ev.request)
  return asObject(request?.providerContext)
}

export function findCodexMcpElicitationQuestionEvent(
  session: StreamSession,
  toolId: string,
): TranscriptEnvelope | null {
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    if (!isTranscriptEnvelope(event) || event.ev.type !== 'approval.request') {
      continue
    }
    if (event.ev.interactionKind !== 'ask_user_question') {
      continue
    }
    if (event.ev.toolCallId !== toolId) {
      continue
    }
    const providerContext = readProviderContext(event)
    if (providerContext?.provider === 'codex' && providerContext.answerFormat === 'codex.mcp_elicitation') {
      return event
    }
  }
  return null
}

function firstAnswerValue(answers: ToolAnswerMap, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = answers[key]
    if (Array.isArray(value)) {
      const joined = value.map((entry) => String(entry).trim()).filter(Boolean).join(', ')
      if (joined) {
        return joined
      }
      continue
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function schemaFieldEntries(schema: unknown): Array<{
  name: string
  property: Record<string, unknown> | null
}> {
  const properties = readSchemaProperties(schema)
  if (!properties) {
    return []
  }

  return Object.entries(properties)
    .filter(([name]) => name.trim().length > 0)
    .map(([name, rawProperty]) => ({
      name,
      property: asObject(rawProperty),
    }))
}

function answerKeysFromQuestionEvent(event: TranscriptEnvelope): string[] {
  if (event.ev.type !== 'approval.request' || !Array.isArray(event.ev.questions)) {
    return []
  }

  const keys: string[] = []
  for (const question of event.ev.questions) {
    const record = asObject(question)
    if (!record) {
      continue
    }
    for (const key of ['id', 'question', 'header']) {
      const value = readTrimmedString(record[key])
      if (value) {
        keys.push(value)
      }
    }
  }
  return [...new Set(keys)]
}

function answerKeysFromQuestionEventForSchemaField(event: TranscriptEnvelope, fieldName: string): string[] {
  if (event.ev.type !== 'approval.request' || !Array.isArray(event.ev.questions)) {
    return []
  }

  const keys: string[] = []
  for (const question of event.ev.questions) {
    const record = asObject(question)
    if (!record) {
      continue
    }
    const id = readTrimmedString(record.id)
    if (id !== fieldName) {
      continue
    }
    for (const key of ['id', 'question', 'header']) {
      const value = readTrimmedString(record[key])
      if (value) {
        keys.push(value)
      }
    }
  }
  return [...new Set(keys)]
}

function answerKeysFromSchemaField(
  field: { name: string; property: Record<string, unknown> | null },
): string[] {
  return [...new Set([
    field.name,
    readTrimmedString(field.property?.title),
    readTrimmedString(field.property?.description),
  ].filter((value): value is string => Boolean(value)))]
}

function buildCodexMcpElicitationAcceptContentFromAnswers(
  requestedSchema: unknown,
  event: TranscriptEnvelope,
  answers: ToolAnswerMap,
): Record<string, unknown> {
  const fields = schemaFieldEntries(requestedSchema)
  if (fields.length === 0) {
    const message = firstAnswerValue(answers, [
      ...answerKeysFromQuestionEvent(event),
      'response',
      'message',
      'customResponse',
    ])
    return message ? { message } : {}
  }

  const content: Record<string, unknown> = {}
  for (const field of fields) {
    const message = firstAnswerValue(answers, [
      ...answerKeysFromQuestionEventForSchemaField(event, field.name),
      ...answerKeysFromSchemaField(field),
    ])
    content[field.name] = coerceElicitationValue(field.property, message)
  }
  return content
}

function buildToolResultPayload(toolId: string, answers: ToolAnswerMap): StreamJsonEvent {
  const serialized: Record<string, string> = {}
  for (const [key, val] of Object.entries(answers)) {
    serialized[key] = Array.isArray(val) ? val.join(', ') : String(val)
  }
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolId,
        content: JSON.stringify({ answers: serialized, annotations: {} }),
      }],
    },
  }
}

export function deliverCodexMcpElicitationQuestionAnswer(
  session: StreamSession,
  event: TranscriptEnvelope,
  answers: ToolAnswerMap,
): { ok: true; payload: StreamJsonEvent } | { ok: false; reason: string } {
  if (event.ev.type !== 'approval.request' || !event.ev.toolCallId) {
    return { ok: false, reason: 'Codex MCP elicitation question event is unavailable' }
  }
  const providerContext = readProviderContext(event)
  const requestId = providerContext?.requestId
  if (!providerContext || typeof requestId !== 'number') {
    return { ok: false, reason: 'Codex MCP elicitation request id is unavailable' }
  }
  const runtime = readCodexRuntime(session)
  if (!runtime) {
    return { ok: false, reason: 'Codex runtime is unavailable' }
  }
  const requestedSchema = providerContext.requestedSchema

  runtime.sendResponse(
    requestId,
    {
      action: 'accept',
      content: buildCodexMcpElicitationAcceptContentFromAnswers(requestedSchema, event, answers),
    },
  )

  markCodexTurnHealthy(session)
  return { ok: true, payload: buildToolResultPayload(event.ev.toolCallId, answers) }
}

export function sendCodexMcpElicitationReply(
  session: StreamSession,
  rawEvent: CodexMcpElicitationApprovalRawEvent,
  decision: 'accept' | 'decline' | 'cancel',
  options: { scheduleTurnWatchdog?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const runtime = readCodexRuntime(session)
  if (!runtime) {
    return { ok: false, reason: 'Codex runtime is unavailable' }
  }
  const result = buildCodexMcpElicitationResult(
    {
      requestId: rawEvent.requestId,
      requestedSchema: rawEvent.requestedSchema,
    },
    decision === 'accept' ? 'approve' : decision === 'cancel' ? 'cancel' : 'reject',
  )
  runtime.sendResponse(result.requestId, result.result)
  markCodexTurnHealthy(session)
  if (!session.lastTurnCompleted && options.scheduleTurnWatchdog !== false) {
    rawEvent.replyDeps.scheduleTurnWatchdog(session)
  }

  const event: StreamJsonEvent = {
    type: 'system',
    text: decision === 'accept'
      ? `Accepted Codex MCP elicitation request ${rawEvent.requestId}.`
      : decision === 'cancel'
        ? `Cancelled Codex MCP elicitation request ${rawEvent.requestId}.`
        : `Declined Codex MCP elicitation request ${rawEvent.requestId}.`,
  }
  rawEvent.replyDeps.appendEvent(session, event)
  rawEvent.replyDeps.broadcastEvent(session, event)
  rawEvent.replyDeps.schedulePersistedSessionsWrite()
  return { ok: true }
}

function codexMcpDecisionFromPolicyDecision(
  decision: ActionPolicyGateResult['decision'],
): 'accept' | 'decline' | 'cancel' {
  if (decision === 'allow') {
    return 'accept'
  }
  if (decision === 'cancel') {
    return 'cancel'
  }
  return 'decline'
}

export const codexMcpElicitationApprovalAdapter: ProviderApprovalAdapter<CodexMcpElicitationApprovalRawEvent, void> = {
  source: 'codex',

  toUnifiedRequest(rawEvent, session) {
    return {
      source: 'codex',
      toolName: rawEvent.toolName,
      toolInput: rawEvent.toolInput,
      sessionName: session.name,
      fallbackSessionName: session.name,
      providerContext: {
        provider: 'codex',
        interaction: 'mcp_elicitation',
        requestId: rawEvent.requestId,
        threadId: rawEvent.threadId,
        toolCallId: rawEvent.toolCallId,
        serverName: rawEvent.serverName,
        tool: rawEvent.tool,
        mode: rawEvent.mode,
      },
    }
  },

  async sendReply(
    result: ActionPolicyGateResult,
    rawEvent: CodexMcpElicitationApprovalRawEvent,
    session: StreamSession,
  ): Promise<void> {
    const delivery = sendCodexMcpElicitationReply(
      session,
      rawEvent,
      codexMcpDecisionFromPolicyDecision(result.decision),
    )
    if (!delivery.ok) {
      throw new Error(delivery.reason)
    }
  },
}
