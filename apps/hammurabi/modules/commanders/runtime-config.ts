import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  defaultCommanderRuntimeConfigPath as resolveSharedCommanderRuntimeConfigPath,
} from '@gehirn/hammurabi-cli/commander-runtime-config-node'
import {
  createDefaultCommanderRuntimeConfig,
  type CommanderRuntimeConfig,
} from './runtime-config.shared.js'

function parseYamlScalar(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed.length) {
    return ''
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1)
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }

  if (trimmed === 'true') {
    return true
  }
  if (trimmed === 'false') {
    return false
  }
  if (trimmed === 'null' || trimmed === '~') {
    return null
  }

  return trimmed
}

function parseSimpleYamlObject(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [
    { indent: -1, value: root },
  ]

  for (const rawLine of content.split(/\r?\n/g)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const indent = rawLine.match(/^ */)?.[0].length ?? 0
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]!.value
    if (trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1).trim()
      if (!key) {
        continue
      }
      const child: Record<string, unknown> = {}
      parent[key] = child
      stack.push({ indent, value: child })
      continue
    }

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = parseYamlScalar(trimmed.slice(separatorIndex + 1))
    if (!key) {
      continue
    }

    parent[key] = value
  }

  return root
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function readNestedValue(
  record: Record<string, unknown>,
  pathParts: string[],
): unknown {
  let current: unknown = record
  for (const part of pathParts) {
    const next = asObject(current)
    if (!next || !(part in next)) {
      return undefined
    }
    current = next[part]
  }
  return current
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function defaultCommanderRuntimeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(resolveSharedCommanderRuntimeConfigPath({ env }))
}

export function loadCommanderRuntimeConfig(
  options: {
    filePath?: string
    env?: NodeJS.ProcessEnv
  } = {},
): CommanderRuntimeConfig {
  const fallback = createDefaultCommanderRuntimeConfig()
  const configPath = path.resolve(
    options.filePath ?? defaultCommanderRuntimeConfigPath(options.env),
  )

  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        ...fallback,
        source: {
          path: configPath,
          exists: false,
        },
      }
    }
    throw error
  }

  const parsed = parseSimpleYamlObject(raw)
  const configuredLimit = readPositiveInteger(
    readNestedValue(parsed, ['commanders', 'runtime', 'limits', 'maxTurns']),
  )
  const limit = configuredLimit ?? fallback.limits.maxTurns
  const configuredDefault = readPositiveInteger(
    readNestedValue(parsed, ['commanders', 'runtime', 'defaults', 'maxTurns']),
  )
  const defaultMaxTurns = Math.min(
    configuredDefault ?? fallback.defaults.maxTurns,
    limit,
  )
  const configuredPrunerEnabled = readBoolean(
    readNestedValue(parsed, ['agents', 'pruner', 'enabled']),
  )
  const configuredSweepIntervalMs = readPositiveInteger(
    readNestedValue(parsed, ['agents', 'pruner', 'sweepIntervalMs']),
  )
  const configuredStaleSessionTtlMs = readPositiveInteger(
    readNestedValue(parsed, ['agents', 'pruner', 'staleSessionTtlMs']),
  )
  const configuredExitedSessionTtlMs = readPositiveInteger(
    readNestedValue(parsed, ['agents', 'pruner', 'exitedSessionTtlMs']),
  )

  return {
    defaults: {
      maxTurns: defaultMaxTurns,
    },
    limits: {
      maxTurns: limit,
    },
    agents: {
      pruner: {
        enabled: configuredPrunerEnabled ?? fallback.agents.pruner.enabled,
        sweepIntervalMs: configuredSweepIntervalMs ?? fallback.agents.pruner.sweepIntervalMs,
        staleSessionTtlMs: configuredStaleSessionTtlMs ?? fallback.agents.pruner.staleSessionTtlMs,
        exitedSessionTtlMs: configuredExitedSessionTtlMs ?? fallback.agents.pruner.exitedSessionTtlMs,
      },
    },
    source: {
      path: configPath,
      exists: true,
    },
  }
}
