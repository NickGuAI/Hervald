import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ai.gehirn.hammurabi',
  appName: 'Hervald',
  webDir: 'dist',
  // Bundled mode: app loads from built assets. API/WebSocket use getApiBase/getWsBase
  // to target https://hervald.gehirn.ai when Capacitor.isNativePlatform().
  ios: {
    contentInset: 'automatic',
  },
}

export default config
