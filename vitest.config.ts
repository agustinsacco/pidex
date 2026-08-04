import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'shared'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    include: [
      'electron/**/*.test.ts',
      'shared/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    // Node by default; DOM-dependent suites opt in per file with
    // `// @vitest-environment jsdom` so the fast majority stay in node.
    environment: 'node',
  },
})
