import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { resolveCommanderNamesPath } from './paths.js'
import { CommanderSessionStore } from './store.js'

export async function getCommanderLabels(
  commanderSessionStorePath?: string,
): Promise<Record<string, string>> {
  const dataDir = commanderSessionStorePath
    ? path.dirname(path.resolve(commanderSessionStorePath))
    : undefined

  let labels: Record<string, string> = {}

  try {
    const namesPath = resolveCommanderNamesPath(dataDir)
    const content = await readFile(namesPath, 'utf8')
    labels = JSON.parse(content) as Record<string, string>
  } catch {
    labels = {}
  }

  try {
    const commanderStore = commanderSessionStorePath !== undefined
      ? new CommanderSessionStore(commanderSessionStorePath)
      : new CommanderSessionStore()
    const commanderSessions = await commanderStore.list()
    for (const commanderSession of commanderSessions) {
      const host = commanderSession.host.trim()
      if (host.length > 0) {
        labels[commanderSession.id] = host
      }
    }
  } catch {
    // Fall back to names.json when the commander store is unavailable.
  }

  return labels
}
