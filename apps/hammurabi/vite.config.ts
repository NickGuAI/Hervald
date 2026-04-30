import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version?: string
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const appVersion = pkg.version ?? '0.0.0'
  const buildCommit = env.LAUNCH_COMMIT || env.VITE_BUILD_COMMIT || ''

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@modules': path.resolve(__dirname, './modules'),
      },
    },
    // Expose real version + build commit to the client so mobile Settings
    // footer renders `hervald · v{version} · build {sha}` instead of stubs.
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(buildCommit),
    },
    server: {
      port: 5200,
      proxy: {
        '/api': {
          target: 'http://localhost:20001',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
