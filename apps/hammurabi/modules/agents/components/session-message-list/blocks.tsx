import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUBAGENT_WORKING_LABEL, type MsgItem } from '../../messages/model'
import { formatToolDisplayName, getToolMeta, isAgentAccentColor } from './tool-meta'

export function SystemDivider({ text }: { text: string }) {
  if (!text) {
    return null
  }

  return (
    <div className="message msg-system flex items-center gap-2 px-1 py-1">
      <div className="msg-system-line h-px flex-1 bg-white/10" />
      <span className="msg-system-text font-mono text-[10px] uppercase tracking-widest text-white/40">
        {text}
      </span>
      <div className="msg-system-line h-px flex-1 bg-white/10" />
    </div>
  )
}

export function UserMessage({
  text,
  images,
}: {
  text: string
  images?: { mediaType: string; data: string }[]
}) {
  return (
    <div className="message msg-user-row flex justify-end">
      <div className="msg-user max-w-[85%] rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
        {images && images.length > 0 && (
          <div className="msg-attachments mb-2 flex flex-wrap gap-2">
            {images.map((image, index) => (
              <img
                key={`${image.mediaType}-${index}`}
                src={`data:${image.mediaType};base64,${image.data}`}
                className="msg-attachment max-h-48 max-w-xs rounded border border-emerald-300/30"
                alt="attachment"
              />
            ))}
          </div>
        )}
        {text && text !== '[image]' ? (
          <div className="msg-user-md break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="message msg-thinking rounded border border-violet-300/20 bg-violet-500/8">
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        className="msg-thinking-toggle flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        <Brain size={11} className="msg-thinking-icon shrink-0 text-violet-400" />
        <span className="msg-thinking-label font-mono text-[10px] uppercase tracking-widest text-violet-300/80">
          Thinking
        </span>
        <ChevronRight
          size={11}
          className={cn(
            'msg-collapse-icon ml-auto shrink-0 text-violet-300/60 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="msg-thinking-body border-t border-violet-300/15 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-violet-200/70 whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
    </div>
  )
}

export function PlanningBlock({ msg }: { msg: MsgItem }) {
  const [expanded, setExpanded] = useState(true)
  const action = msg.planningAction ?? 'enter'

  if (action === 'enter') {
    return (
      <div className="message msg-plan rounded border border-amber-200/15 bg-amber-500/[0.06] px-3 py-2">
        <div className="msg-plan-label flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-100/70">
          <FileText size={11} className="msg-plan-icon shrink-0 text-amber-200/80" />
          <span>Agent entered plan mode</span>
        </div>
      </div>
    )
  }

  if (action === 'proposed') {
    return (
      <div className="message msg-plan rounded border border-white/10 bg-white/[0.03]">
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="msg-plan-toggle flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <FileText size={12} className="msg-plan-icon shrink-0 text-amber-200/80" />
          <span className="msg-plan-label font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
            Proposed Plan
          </span>
          <ChevronRight
            size={12}
            className={cn(
              'msg-collapse-icon ml-auto shrink-0 text-white/40 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </button>
        {expanded && (
          <div className="msg-plan-body border-t border-white/8 px-3 py-3">
            <div className="msg-plan-markdown break-words text-zinc-900 dark:text-zinc-100">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.planningPlan ?? msg.text}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (action !== 'decision') {
    return null
  }

  const decisionLabel =
    msg.planningApproved === true
      ? 'Approved'
      : msg.planningApproved === false
        ? 'Rejected'
        : 'Decision recorded'
  const decisionClass =
    msg.planningApproved === true
      ? 'border-emerald-300/20 bg-emerald-500/8 text-emerald-300/80'
      : msg.planningApproved === false
        ? 'border-red-300/20 bg-red-500/8 text-red-300/80'
        : 'border-white/10 bg-white/[0.04] text-white/65'
  const DecisionIcon = msg.planningApproved === false ? AlertTriangle : Check
  const decisionMessage = (msg.planningMessage ?? msg.text).trim()

  return (
    <div className="message msg-plan rounded border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'msg-plan-decision inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]',
            decisionClass,
          )}
        >
          <DecisionIcon size={10} />
          {decisionLabel}
        </span>
      </div>
      {decisionMessage && (
        <div className="msg-plan-body mt-2 border-t border-white/8 pt-2 text-sm leading-relaxed text-white/70 whitespace-pre-wrap break-words">
          {decisionMessage}
        </div>
      )}
    </div>
  )
}

export function AgentMessage({
  text,
  avatarUrl,
  accentColor,
}: {
  text: string
  avatarUrl?: string | null
  accentColor?: string | null
}) {
  if (!text.trim()) {
    return null
  }

  const safeAccent =
    accentColor && isAgentAccentColor(accentColor) ? accentColor.trim() : null

  return (
    <div className="message msg-agent-row flex items-start gap-2">
      <div className="msg-agent-avatar mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sky-500/15 text-sky-400">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Bot size={13} />
        )}
      </div>
      <div
        className={cn(
          'msg-agent min-w-0 flex-1 rounded-r-lg rounded-bl-lg border border-white/[0.12] border-l-[3px] bg-[#242424] p-3.5',
          !safeAccent && 'border-l-sky-400/70',
        )}
        style={safeAccent ? { borderLeftColor: safeAccent } : undefined}
      >
        <div className="msg-agent-md break-words text-zinc-900 dark:text-zinc-100">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export function RunningAgentsPanel({ messages }: { messages: MsgItem[] }) {
  const running = messages.filter(
    (message) =>
      message.kind === 'tool'
      && message.toolName === 'Agent'
      && message.toolStatus === 'running',
  )
  if (running.length === 0) {
    return null
  }

  return (
    <div className="message msg-running-agents rounded border border-violet-300/20 bg-violet-500/8 px-2.5 py-2">
      <div className="running-agents-label mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-violet-300/80">
        <Bot size={11} className="running-agents-icon" />
        Running Sub-agents
      </div>
      {running.map((message) => (
        <div key={message.id} className="running-agent-item flex items-center gap-1.5 text-xs text-violet-200/70">
          <Loader2 size={10} className="animate-spin" />
          <span>{message.subagentDescription ?? SUBAGENT_WORKING_LABEL}</span>
        </div>
      ))}
    </div>
  )
}

export function ToolBlock({
  msg,
  onAnswer,
  nested = false,
}: {
  msg: MsgItem
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  nested?: boolean
}) {
  const isAgentTool = msg.toolName === 'Agent'
  const children = msg.children ?? []
  const hasChildren = children.length > 0
  const [expanded, setExpanded] = useState(
    isAgentTool && hasChildren && msg.toolStatus === 'running',
  )
  const meta = getToolMeta(msg.toolName ?? '')
  const ToolIcon = meta.icon
  const formatted = formatToolDisplayName(msg.toolName ?? '')
  const hasEditDiff =
    (msg.toolName === 'Edit' || msg.toolName === 'MultiEdit')
    && (msg.oldString || msg.newString)

  useEffect(() => {
    if (isAgentTool && hasChildren) {
      setExpanded(msg.toolStatus === 'running')
      return
    }
    if (isAgentTool) {
      setExpanded(false)
    }
  }, [hasChildren, isAgentTool, msg.toolStatus])

  const statusIcon =
    msg.toolStatus === 'running' ? (
      <Loader2 size={11} className="animate-spin text-amber-400/80" />
    ) : msg.toolStatus === 'error' ? (
      <AlertTriangle size={11} className="text-red-400" />
    ) : (
      <Check size={11} className="text-emerald-400" />
    )

  const statusText =
    msg.toolStatus === 'running'
      ? 'running'
      : msg.toolStatus === 'error'
        ? 'error'
        : 'done'

  const statusColor =
    msg.toolStatus === 'running'
      ? 'text-amber-400/80'
      : msg.toolStatus === 'error'
        ? 'text-red-400'
        : 'text-emerald-400'

  void onAnswer

  return (
    <div
      className={cn(
        'message msg-tool rounded border border-white/10 bg-black/25',
        nested && 'border-white/8',
      )}
      data-nested={nested || undefined}
    >
      <button
        type="button"
        className="msg-tool-header flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setExpanded((previous) => !previous)}
      >
        <div className={cn('msg-tool-icon shrink-0', meta.colorClass)}>
          <ToolIcon size={13} />
        </div>
        <div className="msg-tool-meta min-w-0 flex-1">
          <div className="msg-tool-title truncate font-mono text-[11px] text-white/85">
            {isAgentTool ? (
              <span>Agent: {msg.subagentDescription ?? SUBAGENT_WORKING_LABEL}</span>
            ) : (
              <>
                {formatted.service && (
                  <span className="mr-1 text-[10px] text-white/45">
                    {formatted.service}
                    <span className="mx-1 opacity-50">/</span>
                  </span>
                )}
                {formatted.displayName}
              </>
            )}
          </div>
          {msg.toolFile && (
            <div className="msg-tool-path truncate font-mono text-[10px] text-white/45">
              {msg.toolFile}
            </div>
          )}
        </div>
        <div
          className={cn(
            'msg-tool-status flex shrink-0 items-center gap-1 font-mono text-[10px]',
            statusColor,
          )}
        >
          {statusIcon}
          <span>{statusText}</span>
        </div>
        <ChevronRight
          size={12}
          className={cn(
            'msg-collapse-icon shrink-0 text-white/40 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="msg-tool-body border-t border-white/8 px-2.5 py-2 font-mono text-[11px] text-white/60">
          {hasEditDiff ? (
            <div className="msg-tool-diff space-y-1">
              {msg.oldString && (
                <div className="msg-tool-diff-old whitespace-pre-wrap break-words rounded bg-red-500/10 px-2 py-1 text-red-300/80 line-through">
                  {msg.oldString}
                </div>
              )}
              {msg.newString && (
                <div className="msg-tool-diff-new whitespace-pre-wrap break-words rounded bg-emerald-500/10 px-2 py-1 text-emerald-300/80">
                  {msg.newString}
                </div>
              )}
            </div>
          ) : (
            <div className="msg-tool-input whitespace-pre-wrap break-words">{msg.toolInput ?? ''}</div>
          )}
          {msg.toolOutput && (
            <div className="msg-tool-output mt-2 border-t border-white/8 pt-2">
              <div className="msg-tool-section-label mb-1 uppercase tracking-widest text-[10px] text-white/40">
                output
              </div>
              <div className="msg-tool-output-text whitespace-pre-wrap break-words text-white/70">
                {msg.toolOutput}
              </div>
            </div>
          )}
          {hasChildren && (
            <div className="msg-tool-output mt-2 border-t border-white/8 pt-2">
              <div className="msg-tool-section-label mb-1 font-mono text-[10px] uppercase tracking-widest text-white/40">
                activity
              </div>
              <div className="msg-tool-activity space-y-1 rounded border border-white/8 bg-black/30 p-1.5">
                {children.map((child) => {
                  switch (child.kind) {
                    case 'system':
                      return <SystemDivider key={child.id} text={child.text} />
                    case 'tool':
                      return (
                        <ToolBlock key={child.id} msg={child} nested onAnswer={onAnswer} />
                      )
                    case 'agent':
                      return <AgentMessage key={child.id} text={child.text} />
                    case 'thinking':
                      return <ThinkingBlock key={child.id} text={child.text} />
                    case 'planning':
                      return <PlanningBlock key={child.id} msg={child} />
                    case 'user':
                      return (
                        <UserMessage key={child.id} text={child.text} images={child.images} />
                      )
                    case 'ask':
                      return (
                        <AskUserQuestionBlock
                          key={child.id}
                          msg={child}
                          onAnswer={onAnswer}
                        />
                      )
                    default:
                      return null
                  }
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolCallGroup({
  tools,
  onAnswer,
}: {
  tools: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const running = tools.filter((tool) => tool.toolStatus === 'running').length
  const errors = tools.filter((tool) => tool.toolStatus === 'error').length
  const done = tools.filter((tool) => tool.toolStatus === 'success').length

  const statusLabel =
    running > 0 ? `${running} running` : errors > 0 ? `${errors} failed` : 'done'
  const statusColor =
    running > 0 ? 'text-amber-400/80' : errors > 0 ? 'text-red-400' : 'text-emerald-400'

  return (
    <div className="message msg-tool-group rounded border border-white/10 bg-black/25">
      <button
        type="button"
        className="msg-tool-group-header flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setExpanded((previous) => !previous)}
      >
        <ChevronsUpDown size={12} className="msg-tool-group-icon shrink-0 text-white/40" />
        <span className="msg-tool-group-count font-mono text-[11px] text-white/85">
          {tools.length} tool calls
        </span>
        <div
          className={cn(
            'msg-tool-group-status flex shrink-0 items-center gap-1 font-mono text-[10px]',
            statusColor,
          )}
        >
          {running > 0 ? (
            <Loader2 size={10} className="animate-spin" />
          ) : errors > 0 ? (
            <AlertTriangle size={10} />
          ) : (
            <Check size={10} />
          )}
          <span>{statusLabel}</span>
        </div>
        {done > 0 && running > 0 && (
          <span className="msg-tool-group-progress font-mono text-[10px] text-white/40">
            {done}/{tools.length}
          </span>
        )}
        <ChevronRight
          size={12}
          className={cn(
            'msg-collapse-icon ml-auto shrink-0 text-white/40 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="msg-tool-group-body border-t border-white/8 space-y-1 p-1.5">
          {tools.map((tool) => (
            <ToolBlock key={tool.id} msg={tool} onAnswer={onAnswer} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AskUserQuestionBlock({
  msg,
  onAnswer,
}: {
  msg: MsgItem
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
}) {
  const questions = msg.askQuestions ?? []
  const [selections, setSelections] = useState<Record<number, string[]>>(() =>
    Object.fromEntries(questions.map((_, index) => [index, []])),
  )
  const [customTexts, setCustomTexts] = useState<Record<number, string>>(() =>
    Object.fromEntries(questions.map((_, index) => [index, ''])),
  )

  if (msg.askAnswered) {
    return (
      <div className="message msg-ask-done flex items-center gap-1.5 rounded border border-emerald-300/20 bg-emerald-500/8 px-2.5 py-2 font-mono text-[11px] text-emerald-300/70">
        <Check size={11} />
        <span>Response submitted</span>
      </div>
    )
  }

  function toggleOption(questionIndex: number, label: string, multiSelect: boolean) {
    setSelections((prev) => {
      const current = prev[questionIndex] ?? []
      if (multiSelect) {
        return {
          ...prev,
          [questionIndex]: current.includes(label)
            ? current.filter((value) => value !== label)
            : [...current, label],
        }
      }
      return { ...prev, [questionIndex]: [label] }
    })
  }

  function handleSubmit() {
    const answers: Record<string, string[]> = {}
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i]
      const selected = selections[i] ?? []
      const custom = customTexts[i]?.trim()
      answers[question.question] = custom ? [...selected, custom] : selected
    }
    onAnswer(msg.toolId ?? '', answers)
  }

  const allAnswered = questions.every((_, index) => {
    const selected = selections[index] ?? []
    const custom = customTexts[index]?.trim()
    return selected.length > 0 || Boolean(custom)
  })

  return (
    <div className="message msg-ask rounded border border-emerald-300/20 bg-emerald-500/8 px-2.5 py-2">
      <div className="msg-ask-label mb-2 font-mono text-[10px] uppercase tracking-widest text-emerald-300/70">
        Question
      </div>
      <div className="msg-ask-questions space-y-3">
        {questions.map((question, questionIndex) => (
          <div key={questionIndex} className="msg-ask-question">
            <p className="msg-ask-question-text mb-1.5 text-sm text-white/90">{question.question}</p>
            <div className="msg-ask-options flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const selected = (selections[questionIndex] ?? []).includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() =>
                      toggleOption(questionIndex, option.label, question.multiSelect)
                    }
                    title={option.description}
                    className={cn(
                      'msg-ask-chip flex items-center gap-1 rounded border px-2 py-1 text-xs transition',
                      selected
                        ? 'border-emerald-300/50 bg-emerald-300/20 text-emerald-100'
                        : 'border-white/15 bg-black/30 text-white/70 hover:border-white/30',
                    )}
                  >
                    {selected && <Check size={10} />}
                    {option.label}
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              className="msg-ask-other mt-1.5 w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-xs text-white placeholder:text-white/35 focus:border-emerald-300/50 focus:outline-none"
              placeholder="Other..."
              value={customTexts[questionIndex] ?? ''}
              onChange={(event) =>
                setCustomTexts((prev) => ({ ...prev, [questionIndex]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allAnswered || !!msg.askSubmitting}
        className="msg-ask-submit mt-3 rounded border border-emerald-300/35 bg-emerald-300/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-emerald-100 transition enabled:hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {msg.askSubmitting ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  )
}
