import type { MsgItem } from './model.js'

export interface FrontendThinkingBlock {
  thinking?: string
  text?: string
  signature?: string
}

export interface FrontendThinkingState {
  currentBlock: {
    type: 'text' | 'thinking' | 'tool_use' | 'planning_tool_use'
    msgId: string
    toolName?: string
    toolId?: string
    inputJsonParts?: string[]
  } | null
}

export interface FrontendRenderer {
  id: string
  renderThinkingBlock(
    previousMessages: ReadonlyArray<MsgItem>,
    block: FrontendThinkingBlock,
    state: FrontendThinkingState,
    nextId: () => string,
  ): MsgItem[]
}

const frontendRendererRegistry = new Map<string, FrontendRenderer>()

export function registerFrontendRenderer<T extends FrontendRenderer>(renderer: T): T {
  const id = renderer.id.trim()
  if (!id) {
    throw new Error('Frontend renderers must declare a non-empty id')
  }

  const existing = frontendRendererRegistry.get(id)
  if (existing && existing !== renderer) {
    throw new Error(`Frontend renderer "${id}" is already registered`)
  }

  frontendRendererRegistry.set(id, renderer)
  return renderer
}

export function getFrontendRenderer(id: string | undefined): FrontendRenderer | undefined {
  if (!id) {
    return undefined
  }
  return frontendRendererRegistry.get(id.trim())
}
