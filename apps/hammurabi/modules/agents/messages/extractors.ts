export function extractToolDetails(
  toolName: string | undefined,
  rawInput: unknown,
): {
  toolInput: string
  toolFile?: string
  oldString?: string
  newString?: string
} {
  let rawJson = ''
  if (typeof rawInput === 'string') {
    rawJson = rawInput
  } else if (rawInput !== undefined) {
    try {
      rawJson = JSON.stringify(rawInput)
    } catch {
      rawJson = String(rawInput)
    }
  }

  let parsed: Record<string, unknown> | null = null
  if (typeof rawInput === 'string') {
    if (rawInput.trim().length > 0) {
      try {
        parsed = JSON.parse(rawInput) as Record<string, unknown>
      } catch {
        parsed = null
      }
    }
  } else if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    parsed = rawInput as Record<string, unknown>
  }

  let toolInput = rawJson
  let toolFile: string | undefined
  let oldString: string | undefined
  let newString: string | undefined

  if (parsed) {
    toolFile = (parsed.file_path ?? parsed.path ?? parsed.command ?? parsed.pattern) as
      | string
      | undefined
    if (toolName === 'Edit' || toolName === 'MultiEdit') {
      oldString = parsed.old_string as string | undefined
      newString = parsed.new_string as string | undefined
      toolFile = parsed.file_path as string | undefined
    }
    if (toolName === 'Bash') {
      toolInput = (parsed.command as string | undefined) ?? rawJson
      toolFile = parsed.command as string | undefined
    }
  }

  return { toolInput, toolFile, oldString, newString }
}

export function extractToolResultOutput(rawOutput: unknown): string | undefined {
  if (rawOutput === undefined || rawOutput === null) {
    return undefined
  }
  if (typeof rawOutput === 'string') {
    return rawOutput
  }
  try {
    return JSON.stringify(rawOutput, null, 2)
  } catch {
    return String(rawOutput)
  }
}

export function extractSubagentDescription(rawInput: unknown): string | undefined {
  let parsed: Record<string, unknown> | null = null

  if (typeof rawInput === 'string') {
    if (!rawInput.trim()) return undefined
    try {
      parsed = JSON.parse(rawInput) as Record<string, unknown>
    } catch {
      return undefined
    }
  } else if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    parsed = rawInput as Record<string, unknown>
  }

  if (!parsed) return undefined
  const description = parsed.description
  if (typeof description === 'string' && description.trim()) {
    return description
  }
  const prompt = parsed.prompt
  if (typeof prompt === 'string' && prompt.trim()) {
    return prompt
  }

  return undefined
}

export function extractAgentMessageText(rawInput: unknown): string | undefined {
  if (typeof rawInput === 'string') {
    return rawInput.trim() ? rawInput : undefined
  }

  if (Array.isArray(rawInput)) {
    const parts = rawInput
      .map((value) => extractAgentMessageText(value) ?? '')
      .filter((value) => value.trim().length > 0)
    return parts.length > 0 ? parts.join('\n') : undefined
  }

  if (!rawInput || typeof rawInput !== 'object') {
    return undefined
  }

  const record = rawInput as Record<string, unknown>
  const directText = extractAgentMessageText(record.text)
  if (directText) {
    return directText
  }

  const directContent = extractAgentMessageText(record.content)
  if (directContent) {
    return directContent
  }

  const nestedMessage = extractAgentMessageText(record.message)
  if (nestedMessage) {
    return nestedMessage
  }

  return undefined
}
