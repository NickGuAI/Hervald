import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface MemoryUpdateResult {
  factsAdded: number
  lineCount: number
}

function normalizeFact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function removeComment(line: string): string {
  return line.replace(/<!--[\s\S]*?-->/g, '').trim()
}

function parseExistingFactKeys(content: string): Set<string> {
  const entries = new Set<string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('- ')) continue
    const text = normalizeFact(removeComment(line).replace(/^-+\s*/, ''))
    if (!text) continue
    entries.add(text.toLowerCase())
  }
  return entries
}

export class MemoryMdWriter {
  private readonly memoryPath: string

  constructor(private readonly memoryRoot: string) {
    this.memoryPath = path.join(memoryRoot, 'MEMORY.md')
  }

  async updateFacts(facts: string[]): Promise<MemoryUpdateResult> {
    let current = '# Commander Memory\n\n'
    try {
      current = await readFile(this.memoryPath, 'utf-8')
    } catch {
      // Use default content.
    }

    const existingKeys = parseExistingFactKeys(current)
    const nextFacts: string[] = []
    for (const fact of facts) {
      const text = normalizeFact(fact)
      if (!text) continue
      const key = text.toLowerCase()
      if (existingKeys.has(key)) {
        continue
      }
      existingKeys.add(key)
      nextFacts.push(text)
    }

    if (nextFacts.length === 0) {
      return {
        factsAdded: 0,
        lineCount: current.split(/\r?\n/).length,
      }
    }

    const next = `${current.trimEnd()}\n\n${nextFacts.map((fact) => `- ${fact}`).join('\n')}\n`
    await writeFile(this.memoryPath, next, 'utf-8')

    return {
      factsAdded: nextFacts.length,
      lineCount: next.split(/\r?\n/).length,
    }
  }
}
