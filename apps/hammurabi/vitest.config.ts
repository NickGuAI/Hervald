import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^react$/,
        replacement: path.resolve(__dirname, './react-with-act.ts'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
      {
        find: '@modules',
        replacement: path.resolve(__dirname, './modules'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['modules/commanders/__tests__/setup-data-dir.ts'],
    watchExclude: [
      'modules/agents/adapters/test-foo/**',
      'modules/agents/providers/.generated/**',
    ],
  },
})
