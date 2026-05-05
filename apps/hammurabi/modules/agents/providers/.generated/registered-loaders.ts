// generated; do not edit

export const adapterImports = {
  "claude": () => import('../../adapters/claude/provider.js'),
  "codex": () => import('../../adapters/codex/provider.js'),
  "gemini": () => import('../../adapters/gemini/provider.js'),
  "opencode": () => import('../../adapters/opencode/provider.js'),
} as const

export const machineAdapterImports = {
  "claude": () => import('../../adapters/claude/machine-adapter.js'),
  "codex": () => import('../../adapters/codex/machine-adapter.js'),
  "gemini": () => import('../../adapters/gemini/machine-adapter.js'),
  "opencode": () => import('../../adapters/opencode/machine-adapter.js'),
} as const
