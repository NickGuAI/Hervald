import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ai.gehirn.hammurabi',
  appName: 'Hervald',
  webDir: 'dist',
  // Bundled mode: app loads from built assets. The native app picks the
  // backend instance URL on first launch via the Connect screen, which
  // persists it in localStorage; getApiBase/getWsBase resolve from that
  // stored URL on every request.
  ios: {
    contentInset: 'automatic',
  },
}

export default config
