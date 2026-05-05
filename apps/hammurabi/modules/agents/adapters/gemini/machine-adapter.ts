import {
  registerMachineProvider,
  type MachineProviderAdapter,
} from '../../providers/machine-provider-adapter-core.js'

export const geminiMachineProvider: MachineProviderAdapter = registerMachineProvider({
  id: 'gemini',
  label: 'Gemini',
  cliBinaryName: 'gemini',
  installPackageName: '@google/gemini-cli',
  authEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  loginStatusCommand: null,
  supportedAuthModes: ['api-key'],
  modeRequiresSecret: (mode) => mode === 'api-key',
  classifyAuthMethod({ envSourceKey }) {
    if (envSourceKey === 'GEMINI_API_KEY' || envSourceKey === 'GOOGLE_API_KEY') {
      return 'api-key'
    }
    return 'missing'
  },
  computeAuthSetupUpdates({ secret }) {
    return {
      GEMINI_API_KEY: secret ?? '',
      GEMINI_FORCE_FILE_STORAGE: '1',
    }
  },
})
