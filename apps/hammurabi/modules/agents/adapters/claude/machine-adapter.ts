import {
  registerMachineProvider,
  type MachineProviderAdapter,
} from '../../providers/machine-provider-adapter-core.js'

export const claudeMachineProvider: MachineProviderAdapter = registerMachineProvider({
  id: 'claude',
  label: 'Claude',
  cliBinaryName: 'claude',
  installPackageName: '@anthropic-ai/claude-code',
  authEnvKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  loginStatusCommand: 'claude auth status',
  supportedAuthModes: ['setup-token'],
  modeRequiresSecret: (mode) => mode === 'setup-token',
  classifyAuthMethod({ envSourceKey, loginConfigured }) {
    if (envSourceKey === 'CLAUDE_CODE_OAUTH_TOKEN') {
      return 'setup-token'
    }
    if (envSourceKey === 'ANTHROPIC_API_KEY' || envSourceKey === 'ANTHROPIC_AUTH_TOKEN') {
      return 'api-key'
    }
    return loginConfigured ? 'login' : 'missing'
  },
  computeAuthSetupUpdates({ secret }) {
    return { CLAUDE_CODE_OAUTH_TOKEN: secret ?? '' }
  },
})
