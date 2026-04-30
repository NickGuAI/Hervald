import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCommanderPaths } from '../paths.js'
import { COMMANDER_WORKFLOW_FILE } from '../workflow.js'

export const COMMANDER_WORKFLOW_TEMPLATE_FILE = 'COMMANDER.template.md'
export const COMMANDER_WORKFLOW_SOURCE_TEMPLATE_FILE = 'workflow.md.template'

const MODULE_TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  COMMANDER_WORKFLOW_SOURCE_TEMPLATE_FILE,
)
const SOURCE_TEMPLATE_PATH = path.join(
  process.cwd(),
  'modules/commanders/templates',
  COMMANDER_WORKFLOW_SOURCE_TEMPLATE_FILE,
)

export interface CommanderWorkflowTemplateInput {
  commanderId: string
  cwd?: string
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function replaceTemplateToken(template: string, token: string, value: string): string {
  return template.split(token).join(value)
}

async function loadCommanderWorkflowTemplate(): Promise<string> {
  const candidates = [MODULE_TEMPLATE_PATH, SOURCE_TEMPLATE_PATH]
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8')
    } catch {
      // Try the next known location. Built JS may run from dist-server while templates
      // remain in the source tree.
    }
  }
  throw new Error(`Commander workflow template not found: ${candidates.join(', ')}`)
}

export async function ensureCommanderWorkflowTemplate(dataDir: string): Promise<string> {
  const templatePath = path.join(dataDir, COMMANDER_WORKFLOW_TEMPLATE_FILE)
  try {
    return await readFile(templatePath, 'utf8')
  } catch {
    const template = await loadCommanderWorkflowTemplate()
    await mkdir(dataDir, { recursive: true })
    await writeFile(templatePath, template, 'utf8')
    return template
  }
}

export function renderCommanderWorkflow(
  template: string,
  input: CommanderWorkflowTemplateInput,
): string {
  const workspaceCwd = normalizeOptional(input.cwd) ?? '_not provided_'
  const withCommanderId = replaceTemplateToken(template, '[COMMANDER_ID]', input.commanderId)
  const withWorkspace = replaceTemplateToken(withCommanderId, '[WORKSPACE_CWD]', workspaceCwd)
  return `${withWorkspace.trimEnd()}\n`
}

export async function scaffoldCommanderWorkflow(
  commanderId: string,
  input: Omit<CommanderWorkflowTemplateInput, 'commanderId'>,
  basePath?: string,
): Promise<string> {
  const { commanderRoot, dataDir } = resolveCommanderPaths(commanderId, basePath)
  await mkdir(commanderRoot, { recursive: true })

  const workflowPath = path.join(commanderRoot, COMMANDER_WORKFLOW_FILE)
  try {
    await access(workflowPath)
    return workflowPath
  } catch {
    const template = await ensureCommanderWorkflowTemplate(dataDir)
    const rendered = renderCommanderWorkflow(template, {
      commanderId,
      cwd: input.cwd,
    })
    await writeFile(workflowPath, rendered, 'utf8')
    return workflowPath
  }
}

export async function readCommanderWorkflowMarkdown(
  commanderId: string,
  basePath?: string,
): Promise<string | null> {
  const { commanderRoot } = resolveCommanderPaths(commanderId, basePath)
  const workflowPath = path.join(commanderRoot, COMMANDER_WORKFLOW_FILE)
  try {
    return await readFile(workflowPath, 'utf8')
  } catch {
    return null
  }
}
