export interface CommanderRuntimeConfig {
  defaults: {
    maxTurns: number
  }
  limits: {
    maxTurns: number
  }
  agents: {
    pruner: {
      enabled: boolean
      sweepIntervalMs: number
      staleSessionTtlMs: number
      exitedSessionTtlMs: number
    }
  }
}

export const DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS = 300
export const DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS = 300
export const DEFAULT_AGENT_PRUNER_ENABLED = true
export const DEFAULT_AGENT_PRUNER_SWEEP_INTERVAL_MS = 10 * 60 * 1000
export const DEFAULT_AGENT_PRUNER_STALE_SESSION_TTL_MS = 60 * 60 * 1000
export const DEFAULT_AGENT_PRUNER_EXITED_SESSION_TTL_MS = 24 * 60 * 60 * 1000

export function createDefaultCommanderRuntimeConfig(): CommanderRuntimeConfig {
  return {
    defaults: {
      maxTurns: DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS,
    },
    limits: {
      maxTurns: DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS,
    },
    agents: {
      pruner: {
        enabled: DEFAULT_AGENT_PRUNER_ENABLED,
        sweepIntervalMs: DEFAULT_AGENT_PRUNER_SWEEP_INTERVAL_MS,
        staleSessionTtlMs: DEFAULT_AGENT_PRUNER_STALE_SESSION_TTL_MS,
        exitedSessionTtlMs: DEFAULT_AGENT_PRUNER_EXITED_SESSION_TTL_MS,
      },
    },
  }
}

export function renderCommanderRuntimeConfig(
  config: CommanderRuntimeConfig = createDefaultCommanderRuntimeConfig(),
): string {
  return [
    '# Hammurabi commander runtime defaults and limits.',
    'commanders:',
    '  runtime:',
    '    defaults:',
    `      maxTurns: ${config.defaults.maxTurns}`,
    '    limits:',
    `      maxTurns: ${config.limits.maxTurns}`,
    'agents:',
    '  pruner:',
    `    enabled: ${config.agents.pruner.enabled}`,
    `    sweepIntervalMs: ${config.agents.pruner.sweepIntervalMs}`,
    `    staleSessionTtlMs: ${config.agents.pruner.staleSessionTtlMs}`,
    `    exitedSessionTtlMs: ${config.agents.pruner.exitedSessionTtlMs}`,
    '',
  ].join('\n')
}
