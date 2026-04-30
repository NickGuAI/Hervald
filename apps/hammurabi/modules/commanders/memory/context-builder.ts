import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { GoalsStore } from './goals-store.js'
import type { PromptTask } from './prompt-task.js'
import { WorkingMemoryStore } from './working-memory.js'
import { resolveCommanderPaths } from '../paths.js'

const DEFAULT_TOKEN_BUDGET = 4_000
const MAX_MEMORY_LINES = 200
const MAX_LONG_TERM_LINES = 100

const LAYER_GOALS = 1.5
const PRIORITY_ORDER = [1, LAYER_GOALS, 2, 3, 6] as const
const RENDER_ORDER = [2, LAYER_GOALS, 1, 3, 6] as const
const LAYER_DROP_ORDER = [6, 3] as const
const HEARTBEAT_LAYER_LABELS: Record<number, string> = {
  1: 'Current Task',
  2: 'Long-term Memory',
  3: 'Working Memory Scratchpad',
  6: 'Recent Conversation',
  [LAYER_GOALS]: 'Active Goals',
}

export interface Message {
  role: string
  content: string
}

export interface ContextBuildOptions {
  currentTask: PromptTask | null
  recentConversation: Message[]
  tokenBudget?: number
}

export interface BuiltContext {
  systemPromptSection: string
  layersIncluded: number[]
  skillsMatched: string[]
  tokenEstimate: number
  droppedLayers: number[]
}

export interface MemoryContextBuilderOptions {}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function trimLines(content: string, maxLines: number): string {
  const lines = content.split(/\r?\n/)
  if (lines.length <= maxLines) {
    return content.trim()
  }
  const trimmed = lines.slice(0, maxLines).join('\n').trim()
  return `${trimmed}\n\n_...truncated to first ${maxLines} lines._`
}

function trimLastLines(content: string, maxLines: number): string {
  const lines = content.split(/\r?\n/)
  if (lines.length <= maxLines) {
    return content.trim()
  }
  const trimmed = lines.slice(-maxLines).join('\n').trim()
  return `${trimmed}\n\n_...truncated to last ${maxLines} lines._`
}

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function toRepo(task: PromptTask | null): string | null {
  if (!task) return null
  if (task.owner && task.repo) return `${task.owner}/${task.repo}`
  return task.repository ?? null
}

export class MemoryContextBuilder {
  private readonly memoryRoot: string
  private readonly workingMemory: WorkingMemoryStore
  private readonly goalsStore: GoalsStore

  constructor(
    commanderId: string,
    basePath?: string,
    _options: MemoryContextBuilderOptions = {},
  ) {
    this.memoryRoot = resolveCommanderPaths(commanderId, basePath).memoryRoot
    this.workingMemory = new WorkingMemoryStore(commanderId, basePath)
    this.goalsStore = new GoalsStore(commanderId, basePath)
  }

  async build(options: ContextBuildOptions): Promise<BuiltContext> {
    const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET

    const [layer1, layerGoals, layer2, layer3] = await Promise.all([
      this.buildLayer1(options.currentTask),
      this.goalsStore.buildContextSection(),
      this.buildLayer2(),
      this.buildLayer3(),
    ])
    const layer6 = this.buildLayer6(options.recentConversation)

    const layers = new Map<number, string>([
      [1, layer1],
      [2, layer2],
    ])
    if (layerGoals) layers.set(LAYER_GOALS, layerGoals)
    if (layer3) layers.set(3, layer3)
    if (layer6) layers.set(6, layer6)

    let systemPromptSection = this.renderSection(layers)
    let tokenEstimate = estimateTokens(systemPromptSection)
    const tokenEstimateAtBudgetCheck = tokenEstimate
    const droppedLayers: number[] = []

    for (const layerId of LAYER_DROP_ORDER) {
      if (tokenEstimate <= tokenBudget) break
      if (!layers.has(layerId)) continue
      layers.delete(layerId)
      droppedLayers.push(layerId)
      systemPromptSection = this.renderSection(layers)
      tokenEstimate = estimateTokens(systemPromptSection)
    }
    if (droppedLayers.length > 0) {
      const droppedLayerNames = droppedLayers.map((layerId) => this.resolveLayerName(layerId)).join(', ')
      console.warn(
        `[WARN] ${new Date().toISOString()} [heartbeat] ${droppedLayers.length} layer(s) dropped - budget exceeded (est ${tokenEstimateAtBudgetCheck}/${tokenBudget} tokens): ${droppedLayerNames}`,
      )
    }

    const layersIncluded = PRIORITY_ORDER.filter((layerId) => layers.has(layerId))
    return {
      systemPromptSection,
      layersIncluded,
      skillsMatched: [],
      tokenEstimate,
      droppedLayers,
    }
  }

  private renderSection(layers: Map<number, string>): string {
    const lines: string[] = ['## Commander Memory', '']
    for (const layerId of RENDER_ORDER) {
      const content = layers.get(layerId)
      if (!content) continue
      lines.push(content.trim(), '')
    }
    return lines.join('\n').trim()
  }

  private async buildLayer1(task: PromptTask | null): Promise<string> {
    const lines: string[] = ['### Current Task']
    const repo = toRepo(task) ?? 'unknown/unknown'
    if (!task) {
      lines.push('_No active task._')
    } else {
      lines.push(`**Issue #${task.number}**: ${task.title} — ${repo}`)
      if (task.body?.trim()) {
        lines.push('', task.body.trim())
      }
      const comments = (task.comments ?? [])
        .filter((comment) => comment.body.trim().length > 0)
        .slice(-5)
      if (comments.length > 0) {
        lines.push('', '#### Recent Comments')
        for (const comment of comments) {
          const metaBits = [comment.author, comment.createdAt].filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
          const meta = metaBits.length > 0 ? `${metaBits.join(' • ')}: ` : ''
          lines.push(`- ${meta}${compactText(comment.body)}`)
        }
      }
    }

    const thinIndex = await this.readThinIndex()
    lines.push('', '### Backlog Overview')
    if (thinIndex) {
      lines.push(thinIndex)
    } else {
      lines.push('_No local thin index found._')
    }
    return lines.join('\n').trim()
  }

  private async buildLayer2(): Promise<string> {
    const memoryPath = path.join(this.memoryRoot, 'MEMORY.md')
    const longTermPath = path.join(this.memoryRoot, 'LONG_TERM_MEM.md')
    let memoryContent = ''
    let longTermNarrativeContent = ''
    try {
      memoryContent = await readFile(memoryPath, 'utf-8')
    } catch {
      // Optional layer fallback
    }
    try {
      longTermNarrativeContent = await readFile(longTermPath, 'utf-8')
    } catch {
      // Optional layer fallback
    }

    const lines = [
      '### Long-term Memory',
      '#### Facts (MEMORY.md)',
      // MEMORY.md is append-oriented. Favor the tail so fresh durable facts are visible,
      // and leave cleanup/compaction to external cron + skill orchestration.
      trimLastLines(memoryContent, MAX_MEMORY_LINES) || '_No fact memory found._',
      '',
      '#### Narrative (LONG_TERM_MEM.md)',
      trimLastLines(longTermNarrativeContent, MAX_LONG_TERM_LINES) || '_No narrative long-term memory found._',
    ]
    return lines.join('\n')
  }

  private async buildLayer3(): Promise<string | null> {
    try {
      return await this.workingMemory.render(6)
    } catch {
      return null
    }
  }

  private buildLayer6(recentConversation: Message[]): string | null {
    const messages = recentConversation
      .filter((message) => typeof message.content === 'string' && message.content.trim().length > 0)
      .slice(-12)
    if (messages.length === 0) return null

    const lines: string[] = ['### Recent Conversation']
    for (const message of messages) {
      const role = message.role?.trim() || 'unknown'
      lines.push(`- ${role}: ${compactText(message.content)}`)
    }
    return lines.join('\n')
  }

  private async readThinIndex(): Promise<string | null> {
    const thinIndexPath = path.join(this.memoryRoot, 'backlog', 'thin-index.md')
    let content = ''
    try {
      content = await readFile(thinIndexPath, 'utf-8')
    } catch {
      return null
    }
    const trimmed = content.trim()
    return trimmed || null
  }

  private resolveLayerName(layerId: number): string {
    return HEARTBEAT_LAYER_LABELS[layerId] ?? `Layer ${layerId}`
  }
}
