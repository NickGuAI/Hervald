import { ensureCodexFileCredentialStore } from '../../machine-auth.js'
import {
  registerMachineProvider,
  type MachineProviderAdapter,
} from '../../providers/machine-provider-adapter-core.js'

export const codexMachineProvider: MachineProviderAdapter = registerMachineProvider({
  id: 'codex',
  label: 'Codex',
  cliBinaryName: 'codex',
  installPackageName: '@openai/codex',
  authEnvKeys: ['OPENAI_API_KEY'],
  loginStatusCommand: 'codex login status',
  supportedAuthModes: ['api-key', 'device-auth'],
  modeRequiresSecret: (mode) => mode === 'api-key',
  classifyAuthMethod({ envSourceKey, loginConfigured }) {
    if (envSourceKey === 'OPENAI_API_KEY') {
      return 'api-key'
    }
    return loginConfigured ? 'device-auth' : 'missing'
  },
  computeAuthSetupUpdates({ mode, secret }) {
    if (mode === 'device-auth') {
      return { OPENAI_API_KEY: null }
    }
    return { OPENAI_API_KEY: secret ?? '' }
  },
  async ensureCredentialStore(machine, homeDir, args) {
    if (args.mode !== 'device-auth') {
      return
    }
    await ensureCodexFileCredentialStore(machine, homeDir)
  },
})
