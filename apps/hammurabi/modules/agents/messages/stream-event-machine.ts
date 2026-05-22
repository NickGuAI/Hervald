import type { AskQuestion, StreamEvent } from '@/types'
import {
  capMessages,
  createUserMessage,
  SUBAGENT_WORKING_LABEL,
  type MsgItem,
} from './model.js'
import {
  extractAgentMessageText,
  extractSubagentDescription,
  extractToolDetails,
  extractToolResultOutput,
} from './extractors.js'
import {
  isPlanningToolName,
  parsePlanningPayload,
  parsePlanningToolResult,
  toPlanningMessage,
  type PlanningToolName,
} from './planning.js'

export type CurrentBlock = {
  type: 'text' | 'thinking' | 'tool_use' | 'planning_tool_use'
  msgId: string
  toolName?: string
  toolId?: string
  inputJsonParts?: string[]
}

export type MutableStreamProcessorState = {
  currentBlock: CurrentBlock | null
  activeAgentMessageIds: string[]
  planningToolNames: Record<string, PlanningToolName>
}

export type StreamEventProcessorContext = {
  state: MutableStreamProcessorState
  nextId: () => string
  setMessages: (updater: (prev: MsgItem[]) => MsgItem[]) => void
  setIsStreaming: (value: boolean) => void
  capMessages?: (msgs: MsgItem[]) => MsgItem[]
  onWorkspaceMutation?: () => void
}

const FILE_MUTATING_TOOLS = new Set(['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

export function createStreamProcessorState(): MutableStreamProcessorState {
  return {
    currentBlock: null,
    activeAgentMessageIds: [],
    planningToolNames: {},
  }
}

export function resetStreamProcessorState(state: MutableStreamProcessorState) {
  state.currentBlock = null
  state.activeAgentMessageIds = []
  state.planningToolNames = {}
}

export function markAskAnsweredMessages(messages: MsgItem[], toolId: string): MsgItem[] {
  return messages.map((message) =>
    message.kind === 'ask' && message.toolId === toolId
      ? { ...message, askAnswered: true }
      : message,
  )
}

function normalizeDescription(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function pushActiveAgentMessageId(state: MutableStreamProcessorState, messageId: string) {
  if (!messageId || state.activeAgentMessageIds.includes(messageId)) {
    return
  }
  state.activeAgentMessageIds.push(messageId)
}

function removeActiveAgentMessageId(state: MutableStreamProcessorState, messageId: string) {
  if (!messageId) {
    return
  }
  state.activeAgentMessageIds = state.activeAgentMessageIds.filter((id) => id !== messageId)
}

function clearActiveAgentMessageIds(state: MutableStreamProcessorState) {
  state.activeAgentMessageIds = []
}

function sameImages(
  left: MsgItem['images'] | undefined,
  right: MsgItem['images'] | undefined,
): boolean {
  const leftImages = left ?? []
  const rightImages = right ?? []
  if (leftImages.length !== rightImages.length) {
    return false
  }
  return leftImages.every((image, index) => {
    const candidate = rightImages[index]
    return image.mediaType === candidate?.mediaType && image.data === candidate?.data
  })
}

function appendUserMessageIfDistinct(
  context: StreamEventProcessorContext,
  text: string,
  images?: MsgItem['images'],
) {
  context.setMessages((prev) => {
    const lastMessage = prev[prev.length - 1]
    if (
      lastMessage?.kind === 'user'
      && lastMessage.text === text
      && sameImages(lastMessage.images, images)
    ) {
      return prev
    }
    return (context.capMessages ?? capMessages)([
      ...prev,
      createUserMessage(context.nextId(), text, images),
    ])
  })
}

function appendPlanningMessage(
  context: StreamEventProcessorContext,
  event: Extract<StreamEvent, { type: 'planning' }>,
) {
  context.setMessages((prev) =>
    (context.capMessages ?? capMessages)([
      ...prev,
      toPlanningMessage(context.nextId(), event),
    ]),
  )
}

function appendPlanApprovalAsk(
  context: StreamEventProcessorContext,
  event: Extract<StreamEvent, { type: 'plan_approval' }>,
) {
  context.setMessages((prev) => {
    const existingIdx = prev.findIndex(
      (message) => message.kind === 'ask' && message.toolId === event.toolId,
    )
    if (existingIdx !== -1) {
      const updated = [...prev]
      updated[existingIdx] = {
        ...updated[existingIdx],
        askInteractionKind: 'plan_approval',
        toolName: event.toolName,
        planApprovalPlan: event.plan,
        planApprovalApproveLabel: event.approveLabel,
        planApprovalRejectLabel: event.rejectLabel,
        planApprovalCustomResponseLabel: event.customResponseLabel,
      }
      return updated
    }
    return (context.capMessages ?? capMessages)([
      ...prev,
      {
        id: context.nextId(),
        kind: 'ask',
        text: '',
        toolId: event.toolId,
        toolName: event.toolName,
        askInteractionKind: 'plan_approval',
        askAnswered: false,
        planApprovalPlan: event.plan,
        planApprovalApproveLabel: event.approveLabel,
        planApprovalRejectLabel: event.rejectLabel,
        planApprovalCustomResponseLabel: event.customResponseLabel,
      },
    ])
  })
}

function appendPlanningToolUse(
  context: StreamEventProcessorContext,
  toolName: PlanningToolName,
  input: unknown,
) {
  if (toolName === 'EnterPlanMode') {
    appendPlanningMessage(context, { type: 'planning', action: 'enter' })
    return
  }

  const parsed = parsePlanningPayload(input)
  if (typeof parsed?.plan === 'string' && parsed.plan.trim()) {
    appendPlanningMessage(context, {
      type: 'planning',
      action: 'proposed',
      plan: parsed.plan.trim(),
    })
  }
}

function appendSubagentSystemMessage(
  context: StreamEventProcessorContext,
  text: string,
  {
    toolUseId,
    descriptionHint,
  }: {
    toolUseId?: string
    descriptionHint?: string
  } = {},
) {
  if (!text.trim()) {
    return
  }

  const childMsg: MsgItem = { id: context.nextId(), kind: 'system', text }
  const normalizedHint = normalizeDescription(descriptionHint)
  const normalizedToolUseId = typeof toolUseId === 'string' ? toolUseId.trim() : ''

  context.setMessages((prev) => {
    if (context.state.activeAgentMessageIds.length > 0) {
      const runningAgentIds = new Set(
        prev
          .filter(
            (message) =>
              message.kind === 'tool'
              && message.toolName === 'Agent'
              && message.toolStatus === 'running',
          )
          .map((message) => message.id),
      )
      context.state.activeAgentMessageIds = context.state.activeAgentMessageIds.filter((id) =>
        runningAgentIds.has(id),
      )
    }

    let parentIndex = -1

    if (normalizedToolUseId) {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const message = prev[i]
        if (
          message.kind === 'tool'
          && message.toolName === 'Agent'
          && message.toolId === normalizedToolUseId
        ) {
          parentIndex = i
          break
        }
      }
    }

    if (parentIndex === -1 && normalizedHint) {
      const activeIds = context.state.activeAgentMessageIds
      for (let i = activeIds.length - 1; i >= 0; i -= 1) {
        const idx = prev.findIndex((message) => message.id === activeIds[i])
        if (idx === -1) {
          continue
        }
        const parent = prev[idx]
        if (
          parent.kind === 'tool'
          && parent.toolName === 'Agent'
          && parent.toolStatus === 'running'
          && normalizeDescription(parent.subagentDescription) === normalizedHint
        ) {
          parentIndex = idx
          break
        }
      }
    }

    if (parentIndex === -1) {
      const activeIds = context.state.activeAgentMessageIds
      for (let i = activeIds.length - 1; i >= 0; i -= 1) {
        const idx = prev.findIndex((message) => message.id === activeIds[i])
        if (idx === -1) {
          continue
        }
        const parent = prev[idx]
        if (
          parent.kind === 'tool'
          && parent.toolName === 'Agent'
          && parent.toolStatus === 'running'
        ) {
          parentIndex = idx
          break
        }
      }
    }

    if (parentIndex === -1) {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const message = prev[i]
        if (
          message.kind === 'tool'
          && message.toolName === 'Agent'
          && message.toolStatus === 'running'
        ) {
          parentIndex = i
          break
        }
      }
    }

    if (parentIndex === -1) {
      return (context.capMessages ?? capMessages)([...prev, childMsg])
    }

    const updated = [...prev]
    const parent = updated[parentIndex]
    if (parent.kind !== 'tool') {
      return (context.capMessages ?? capMessages)([...prev, childMsg])
    }
    updated[parentIndex] = {
      ...parent,
      children: [...(parent.children ?? []), childMsg],
    }
    return (context.capMessages ?? capMessages)(updated)
  })
}

export function processStreamEvent(
  context: StreamEventProcessorContext,
  event: StreamEvent,
  isReplay = false,
) {
  if (event.type === 'agent') {
    const text =
      extractAgentMessageText(event.message)
      ?? extractAgentMessageText(event.text)
      ?? extractAgentMessageText(event)
    if (text) {
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev,
          { id: context.nextId(), kind: 'agent', text },
        ]),
      )
    }
    return
  }

  if (event.type === 'planning') {
    appendPlanningMessage(context, event)
    return
  }

  if (event.type === 'plan_approval') {
    appendPlanApprovalAsk(context, event)
    return
  }

  switch (event.type) {
    case 'assistant': {
      const blocks = event.message?.content
      if (!Array.isArray(blocks)) {
        break
      }

      for (const block of blocks) {
        if (block.type === 'text') {
          const text = block.text ?? ''
          if (!text) {
            continue
          }
          const id = context.nextId()
          context.setMessages((prev) =>
            (context.capMessages ?? capMessages)([
              ...prev,
              { id, kind: 'agent', text },
            ]),
          )
        } else if (block.type === 'thinking') {
          const text =
            (typeof block.thinking === 'string' ? block.thinking : undefined)
            ?? (typeof block.text === 'string' ? block.text : '')
          if (block.presentation?.mergeWithActiveThinking) {
            const activeThinkingMessageId =
              context.state.currentBlock?.type === 'thinking'
                ? context.state.currentBlock.msgId
                : undefined
            const hasThinkingText = text.trim().length > 0

            context.setMessages((prev) => {
              let targetIndex = -1
              if (activeThinkingMessageId) {
                targetIndex = prev.findIndex(
                  (message) =>
                    message.kind === 'thinking' && message.id === activeThinkingMessageId,
                )
              }
              if (targetIndex === -1) {
                for (let i = prev.length - 1; i >= 0; i -= 1) {
                  const message = prev[i]
                  if (message.kind === 'thinking' && !message.text.trim()) {
                    targetIndex = i
                    break
                  }
                }
              }

              if (!hasThinkingText) {
                if (targetIndex === -1) {
                  return prev
                }
                const target = prev[targetIndex]
                if (target.kind !== 'thinking' || target.text.trim()) {
                  return prev
                }
                return prev.filter((message) => message.id !== target.id)
              }

              if (targetIndex !== -1) {
                const target = prev[targetIndex]
                if (target.kind === 'thinking') {
                  if (target.text === text) {
                    return prev
                  }
                  const updated = [...prev]
                  updated[targetIndex] = { ...target, text }
                  return updated
                }
              }

              const id = context.nextId()
              return (context.capMessages ?? capMessages)([
                ...prev,
                { id, kind: 'thinking', text },
              ])
            })

            if (context.state.currentBlock?.type === 'thinking') {
              context.state.currentBlock = null
            }
            continue
          }

          if (!text) {
            continue
          }
          const id = context.nextId()
          context.setMessages((prev) =>
            (context.capMessages ?? capMessages)([
              ...prev,
              { id, kind: 'thinking', text },
            ]),
          )
        } else if ((block as { type?: string }).type === 'agent_message') {
          const text = extractAgentMessageText(block)
          if (!text) {
            continue
          }
          const id = context.nextId()
          context.setMessages((prev) =>
            (context.capMessages ?? capMessages)([
              ...prev,
              { id, kind: 'agent', text },
            ]),
          )
        } else if (block.type === 'tool_use') {
          if (typeof block.id === 'string' && isPlanningToolName(block.name)) {
            context.state.planningToolNames[block.id] = block.name
            appendPlanningToolUse(context, block.name, block.input)
            continue
          }

          const id = context.nextId()
          if (block.name === 'AskUserQuestion') {
            const input = block.input as { questions?: AskQuestion[] } | undefined
            context.setMessages((prev) => {
              const existingIdx = prev.findIndex(
                (message) => message.kind === 'ask' && message.toolId === block.id,
              )
              if (existingIdx !== -1) {
                const nextQuestions = input?.questions
                if (!nextQuestions || nextQuestions.length === 0) {
                  return prev
                }
                const existing = prev[existingIdx]
                if ((existing.askQuestions?.length ?? 0) > 0) {
                  return prev
                }
                const updated = [...prev]
                updated[existingIdx] = { ...existing, askQuestions: nextQuestions }
                return updated
              }
              return (context.capMessages ?? capMessages)([
                ...prev,
                {
                  id,
                  kind: 'ask',
                  text: '',
                  toolId: block.id,
                  toolName: block.name,
                  askQuestions: input?.questions ?? [],
                  askAnswered: false,
                },
              ])
            })
          } else {
            const { toolInput, toolFile, oldString, newString } = extractToolDetails(
              block.name,
              block.input,
            )
            const subagentDescription =
              block.name === 'Agent'
                ? extractSubagentDescription(block.input) ?? SUBAGENT_WORKING_LABEL
                : undefined
            context.setMessages((prev) =>
              (context.capMessages ?? capMessages)([
                ...prev,
                {
                  id,
                  kind: 'tool',
                  text: '',
                  toolId: block.id,
                  toolName: block.name,
                  toolStatus: 'running',
                  toolInput,
                  toolFile,
                  oldString,
                  newString,
                  subagentDescription,
                },
              ]),
            )
            if (block.name === 'Agent') {
              pushActiveAgentMessageId(context.state, id)
            }
          }
        }
      }
      break
    }

    case 'user': {
      const content = event.message?.content
      const hasActiveAgentTool = context.state.activeAgentMessageIds.length > 0
      const subtype = typeof event.subtype === 'string' ? event.subtype : undefined
      const shouldRenderUserEnvelope = isReplay || subtype === 'queued_message'
      if (typeof content === 'string' && content.trim() && shouldRenderUserEnvelope) {
        if (hasActiveAgentTool) {
          break
        }
        appendUserMessageIfDistinct(context, content.trim())
        break
      }
      if (!Array.isArray(content)) {
        break
      }

      if (shouldRenderUserEnvelope) {
        const hasToolResult = content.some((block) => block.type === 'tool_result')
        const hasTextOrImage = content.some(
          (block) => block.type === 'text' || block.type === 'image',
        )
        if (!hasToolResult && hasTextOrImage) {
          if (hasActiveAgentTool) {
            break
          }
          let text = '[image]'
          const images: { mediaType: string; data: string }[] = []
          for (const block of content) {
            if (block.type === 'text' && 'text' in block) {
              text = (block.text as string).trim() || text
            } else if (block.type === 'image' && 'source' in block) {
              const source = block.source as { media_type?: string; data?: string } | undefined
              images.push({ mediaType: source?.media_type ?? '', data: source?.data ?? '' })
            }
          }
          appendUserMessageIfDistinct(context, text, images)
          break
        }
      }

      const toolResults = content.filter((block) => block.type === 'tool_result')
      if (toolResults.length === 0) {
        break
      }

      let shouldTriggerWorkspaceRefresh = false
      context.setMessages((prev) => {
        const updated = [...prev]
        for (const result of toolResults) {
          const planningToolName =
            result.tool_use_id ? context.state.planningToolNames[result.tool_use_id] : undefined
          if (planningToolName) {
            if (planningToolName === 'ExitPlanMode') {
              const planningEvent = parsePlanningToolResult(
                result.content ?? event.tool_use_result,
                result.is_error,
              )
              if (planningEvent) {
                updated.push(toPlanningMessage(context.nextId(), planningEvent))
              }
            }
            delete context.state.planningToolNames[result.tool_use_id!]
            continue
          }
          if (result.tool_use_id) {
            for (let i = updated.length - 1; i >= 0; i -= 1) {
              const message = updated[i]
              if (message.kind === 'ask' && message.toolId === result.tool_use_id) {
                const nextMessage = { ...message, askAnswered: true, askSubmitting: false }
                updated[i] = nextMessage
                if (message.askInteractionKind === 'plan_approval') {
                  const planningEvent = parsePlanningToolResult(
                    result.content ?? event.tool_use_result,
                    result.is_error,
                  )
                  if (planningEvent) {
                    updated.push(toPlanningMessage(context.nextId(), planningEvent))
                  }
                }
                break
              }
            }
          }
          const status = result.is_error ? ('error' as const) : ('success' as const)
          const toolOutput = extractToolResultOutput(result.content)
          let matched = false
          if (result.tool_use_id) {
            for (let i = updated.length - 1; i >= 0; i -= 1) {
              const message = updated[i]
              if (
                message.kind === 'tool'
                && message.toolStatus === 'running'
                && message.toolId === result.tool_use_id
              ) {
                updated[i] =
                  toolOutput === undefined
                    ? { ...message, toolStatus: status }
                    : { ...message, toolStatus: status, toolOutput }
                if (FILE_MUTATING_TOOLS.has(message.toolName ?? '')) {
                  shouldTriggerWorkspaceRefresh = true
                }
                if (message.toolName === 'Agent') {
                  removeActiveAgentMessageId(context.state, message.id)
                }
                matched = true
                break
              }
            }
          }
          if (!matched) {
            for (let i = updated.length - 1; i >= 0; i -= 1) {
              const message = updated[i]
              if (message.kind === 'tool' && message.toolStatus === 'running') {
                updated[i] =
                  toolOutput === undefined
                    ? { ...message, toolStatus: status }
                    : { ...message, toolStatus: status, toolOutput }
                if (FILE_MUTATING_TOOLS.has(message.toolName ?? '')) {
                  shouldTriggerWorkspaceRefresh = true
                }
                if (message.toolName === 'Agent') {
                  removeActiveAgentMessageId(context.state, message.id)
                }
                break
              }
            }
          }
        }
        return (context.capMessages ?? capMessages)(updated)
      })
      if (shouldTriggerWorkspaceRefresh) {
        context.onWorkspaceMutation?.()
      }
      break
    }

    case 'content_block_start': {
      const block = event.content_block
      if (block.type === 'text') {
        const id = context.nextId()
        context.state.currentBlock = { type: 'text', msgId: id }
        context.setMessages((prev) =>
          (context.capMessages ?? capMessages)([
            ...prev,
            { id, kind: 'agent', text: '' },
          ]),
        )
        if (!isReplay) {
          context.setIsStreaming(true)
        }
      } else if (block.type === 'thinking') {
        const id = context.nextId()
        context.state.currentBlock = { type: 'thinking', msgId: id }
        context.setMessages((prev) =>
          (context.capMessages ?? capMessages)([
            ...prev,
            { id, kind: 'thinking', text: '' },
          ]),
        )
        if (!isReplay) {
          context.setIsStreaming(true)
        }
      } else if (block.type === 'tool_use') {
        if (typeof block.id === 'string' && isPlanningToolName(block.name)) {
          context.state.planningToolNames[block.id] = block.name
          if (block.name === 'EnterPlanMode') {
            context.state.currentBlock = null
            appendPlanningMessage(context, { type: 'planning', action: 'enter' })
          } else {
            context.state.currentBlock = {
              type: 'planning_tool_use',
              msgId: context.nextId(),
              toolName: block.name,
              toolId: block.id,
              inputJsonParts: [],
            }
          }
          if (!isReplay) {
            context.setIsStreaming(true)
          }
          break
        }

        const id = context.nextId()
        context.state.currentBlock = {
          type: 'tool_use',
          msgId: id,
          toolName: block.name,
          toolId: block.id,
          inputJsonParts: [],
        }
        if (block.name !== 'AskUserQuestion') {
          context.setMessages((prev) =>
            (context.capMessages ?? capMessages)([
              ...prev,
              {
                id,
                kind: 'tool',
                text: '',
                toolId: block.id,
                toolName: block.name,
                toolStatus: 'running',
                toolInput: '',
                subagentDescription:
                  block.name === 'Agent' ? SUBAGENT_WORKING_LABEL : undefined,
              },
            ]),
          )
          if (block.name === 'Agent') {
            pushActiveAgentMessageId(context.state, id)
          }
        }
        if (!isReplay) {
          context.setIsStreaming(true)
        }
      }
      break
    }

    case 'content_block_delta': {
      const currentBlock = context.state.currentBlock
      if (!currentBlock) {
        break
      }
      const delta = event.delta
      if (delta.type === 'text_delta' && currentBlock.type === 'text') {
        const appendText = delta.text
        context.setMessages((prev) => {
          const last = prev.length - 1
          if (last >= 0 && prev[last].id === currentBlock.msgId) {
            const updated = [...prev]
            updated[last] = { ...prev[last], text: prev[last].text + appendText }
            return updated
          }
          return prev.map((message) =>
            message.id === currentBlock.msgId
              ? { ...message, text: message.text + appendText }
              : message,
          )
        })
      } else if (delta.type === 'thinking_delta' && currentBlock.type === 'thinking') {
        const appendText = delta.thinking
        context.setMessages((prev) => {
          const last = prev.length - 1
          if (last >= 0 && prev[last].id === currentBlock.msgId) {
            const updated = [...prev]
            updated[last] = { ...prev[last], text: prev[last].text + appendText }
            return updated
          }
          return prev.map((message) =>
            message.id === currentBlock.msgId
              ? { ...message, text: message.text + appendText }
              : message,
          )
        })
      } else if (delta.type === 'input_json_delta' && currentBlock.type === 'tool_use') {
        currentBlock.inputJsonParts!.push(delta.partial_json)
      } else if (
        delta.type === 'input_json_delta'
        && currentBlock.type === 'planning_tool_use'
      ) {
        currentBlock.inputJsonParts!.push(delta.partial_json)
      }
      break
    }

    case 'content_block_stop': {
      const currentBlock = context.state.currentBlock
      if (currentBlock?.type === 'text') {
        context.setMessages((prev) => {
          const message = prev.find((entry) => entry.id === currentBlock.msgId)
          if (message && message.kind === 'agent' && !message.text.trim()) {
            return prev.filter((entry) => entry.id !== currentBlock.msgId)
          }
          return prev
        })
      }
      if (currentBlock?.type === 'tool_use') {
        const rawJson = currentBlock.inputJsonParts?.join('') ?? ''
        if (currentBlock.toolName === 'AskUserQuestion') {
          let questions: AskQuestion[] = []
          try {
            const input = JSON.parse(rawJson) as { questions?: AskQuestion[] }
            questions = input.questions ?? []
          } catch {
            // ignore — ask data may already have arrived via envelope event
          }
          context.setMessages((prev) => {
            const existingIdx = prev.findIndex(
              (message) => message.kind === 'ask' && message.toolId === currentBlock.toolId,
            )
            if (existingIdx !== -1) {
              const existing = prev[existingIdx]
              if (questions.length === 0 || (existing.askQuestions?.length ?? 0) > 0) {
                return prev
              }
              const updated = [...prev]
              updated[existingIdx] = { ...existing, askQuestions: questions }
              return updated
            }
            return (context.capMessages ?? capMessages)([
              ...prev,
              {
                id: currentBlock.msgId,
                kind: 'ask',
                text: '',
                toolId: currentBlock.toolId,
                toolName: currentBlock.toolName,
                askQuestions: questions,
                askAnswered: false,
              },
            ])
          })
        } else {
          const { toolInput, toolFile, oldString, newString } = extractToolDetails(
            currentBlock.toolName,
            rawJson,
          )
          const subagentDescription =
            currentBlock.toolName === 'Agent'
              ? extractSubagentDescription(rawJson) ?? SUBAGENT_WORKING_LABEL
              : undefined
          context.setMessages((prev) =>
            prev.map((message) =>
              message.id === currentBlock.msgId
                ? { ...message, toolInput, toolFile, oldString, newString, subagentDescription }
                : message,
            ),
          )
        }
      }
      if (currentBlock?.type === 'planning_tool_use') {
        const rawJson = currentBlock.inputJsonParts?.join('') ?? ''
        appendPlanningToolUse(context, currentBlock.toolName as PlanningToolName, rawJson)
      }
      context.state.currentBlock = null
      break
    }

    case 'message_start': {
      context.setMessages((prev) =>
        prev.map((message) =>
          message.kind === 'tool' && message.toolStatus === 'running'
            ? { ...message, toolStatus: 'success' }
            : message,
        ),
      )
      clearActiveAgentMessageIds(context.state)
      context.setIsStreaming(false)
      break
    }

    case 'message_stop': {
      context.setIsStreaming(false)
      break
    }

    case 'result': {
      const resultStatus = event.is_error ? ('error' as const) : ('success' as const)
      const isSubagentResult = !event.duration_ms
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev.map((message) =>
            message.kind === 'tool' && message.toolStatus === 'running'
              ? { ...message, toolStatus: resultStatus }
              : message,
          ),
          ...(isSubagentResult
            ? []
            : [{ id: context.nextId(), kind: 'system' as const, text: 'Awaiting input' }]),
        ]),
      )
      clearActiveAgentMessageIds(context.state)
      context.setIsStreaming(false)
      context.onWorkspaceMutation?.()
      break
    }

    case 'exit': {
      context.setMessages((prev) => {
        const hasRunning = prev.some(
          (message) => message.kind === 'tool' && message.toolStatus === 'running',
        )
        if (!hasRunning) {
          return (context.capMessages ?? capMessages)([
            ...prev,
            { id: context.nextId(), kind: 'system', text: 'Session ended' },
          ])
        }
        return (context.capMessages ?? capMessages)([
          ...prev.map((message) =>
            message.kind === 'tool' && message.toolStatus === 'running'
              ? { ...message, toolStatus: 'error' as const }
              : message,
          ),
          { id: context.nextId(), kind: 'system', text: 'Session ended' },
        ])
      })
      clearActiveAgentMessageIds(context.state)
      context.setIsStreaming(false)
      break
    }

    case 'system': {
      if (!event.text) {
        const subtype = (event as { subtype?: string }).subtype
        const toolUseId = (event as { tool_use_id?: string }).tool_use_id
        if (subtype === 'task_progress') {
          const description = (event as { description?: string }).description
          const tool = (event as { last_tool_name?: string }).last_tool_name
          const parts = [description, tool ? `[${tool}]` : ''].filter(Boolean)
          if (parts.length > 0) {
            appendSubagentSystemMessage(context, parts.join(' '), {
              toolUseId,
              descriptionHint: description,
            })
          }
        }
        if (subtype === 'task_started') {
          const description = (event as { description?: string }).description
          if (description) {
            appendSubagentSystemMessage(context, `Sub-agent: ${description}`, {
              toolUseId,
              descriptionHint: description,
            })
          }
        }
        if (subtype === 'task_notification') {
          const description = (event as { description?: string }).description
          const summary = (event as { summary?: string }).summary
          const status = (event as { status?: string }).status
          const text =
            summary ?? description ?? (typeof status === 'string' ? `Sub-agent ${status}` : undefined)
          if (text) {
            appendSubagentSystemMessage(context, text, {
              toolUseId,
              descriptionHint: summary ?? description,
            })
          }
        }
        break
      }
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev,
          { id: context.nextId(), kind: 'system', text: event.text ?? '' },
        ]),
      )
      break
    }

    default:
      break
  }
}
