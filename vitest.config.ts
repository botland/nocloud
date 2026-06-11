import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    // Use jsdom for any React component tests (RTL); pure lib/API tests are fine in node too
    environment: 'jsdom',
    globals: true,
    // setupFiles: ['./vitest.setup.ts'], // enable if adding @testing-library/jest-dom matchers
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Focus coverage on source we care about; exclude build, tests, config, deps
      include: ['lib/**/*', 'app/api/**/*', 'components/**/*'],
      exclude: [
        'node_modules',
        '.next',
        'tests',
        '**/*.test.*',
        '**/*.spec.*',
        'vitest.config.*',
        'vitest.setup.*',
      ],
    },
    // Support the project's @/* alias (see tsconfig paths)
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
