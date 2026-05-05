import {
  registerMachineProvider,
  type MachineProviderAdapter,
} from '../../providers/machine-provider-adapter-core.js'

export const opencodeMachineProvider: MachineProviderAdapter = registerMachineProvider({
  id: 'opencode',
  label: 'OpenCode',
  cliBinaryName: 'opencode',
  authEnvKeys: ['OPENCODE_API_KEY'],
  loginStatusCommand: null,
  supportedAuthModes: ['api-key'],
  modeRequiresSecret: (mode) => mode === 'api-key',
  classifyAuthMethod({ envSourceKey }) {
    if (envSourceKey === 'OPENCODE_API_KEY') {
      return 'api-key'
    }
    return 'missing'
  },
  computeAuthSetupUpdates({ secret }) {
    return {
      OPENCODE_API_KEY: secret ?? '',
    }
  },
})
