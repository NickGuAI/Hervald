import {
  resolveCommanderPaths,
} from './paths.js'
import {
  loadCommanderWorkflow,
  mergeWorkflows,
  type CommanderWorkflow,
} from './workflow.js'

export const BASE_SYSTEM_PROMPT =
  'You are Commander, the orchestration agent for GitHub task execution. Follow repo instructions exactly.'

export interface ResolvedCommanderWorkflow {
  workflow: CommanderWorkflow | null
  exists: boolean
}

function mergeCommanderWorkflowPromptTemplates(
  commanderWorkflow: CommanderWorkflow | null,
  workspaceWorkflow: CommanderWorkflow | null,
): string | undefined {
  const commanderPrompt = commanderWorkflow?.systemPromptTemplate?.trim() ?? ''
  const workspacePrompt = workspaceWorkflow?.systemPromptTemplate?.trim() ?? ''

  if (commanderPrompt && workspacePrompt) {
    return `${commanderPrompt}\n\n## Workspace Context\n${workspacePrompt}`
  }

  if (workspacePrompt) {
    return workspacePrompt
  }

  if (commanderPrompt) {
    return commanderPrompt
  }

  return undefined
}

export async function resolveCommanderWorkflow(
  commanderId: string,
  cwd: string | undefined,
  commanderBasePath?: string,
): Promise<ResolvedCommanderWorkflow> {
  const commanderRoot = resolveCommanderPaths(commanderId, commanderBasePath).commanderRoot
  const [commanderWorkflow, workspaceWorkflow] = await Promise.all([
    loadCommanderWorkflow(commanderRoot),
    cwd
      ? loadCommanderWorkflow(cwd, { allowRemovedRuntimeFrontmatterKeys: true })
      : Promise.resolve(null),
  ])
  const mergedWorkflow = mergeWorkflows(commanderWorkflow, workspaceWorkflow)

  if (mergedWorkflow) {
    const mergedPromptTemplate = mergeCommanderWorkflowPromptTemplates(
      commanderWorkflow,
      workspaceWorkflow,
    )
    return {
      workflow: {
        ...mergedWorkflow,
        ...(mergedPromptTemplate ? { systemPromptTemplate: mergedPromptTemplate } : {}),
      },
      exists: true,
    }
  }

  return {
    workflow: null,
    exists: false,
  }
}

export function resolveEffectiveBasePrompt(workflow: CommanderWorkflow | null): string {
  return workflow?.systemPromptTemplate?.trim().length
    ? workflow.systemPromptTemplate
    : BASE_SYSTEM_PROMPT
}
