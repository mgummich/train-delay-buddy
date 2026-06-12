import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals:     true,
    environment: 'jsdom',
    setupFiles:  ['./src/test/polyfills.ts', './src/test/setup.ts'],
    exclude:     ['**/node_modules/**', '**/dist/**'],
    environmentOptions: {
      jsdom: { url: 'http://localhost' },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines:     80,
        functions: 80,
        branches:  75,
        // critical modules: higher thresholds
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/api/types.gen.ts',  // generated, not tested directly
        'src/test/**',
        'src/**/*.stories.*',
        'src/main.tsx',
        'src/router.tsx',
      ],
    },
    // Fake timers for polling tests
    fakeTimers: {
      // Opt-in per test with: vi.useFakeTimers()
    },
    // Suppress Node.js ExperimentalWarning for localStorage (Node 26+ global)
    // that fires before jsdom overrides it.
    poolOptions: {
      forks: { execArgv: ['--disable-warning=ExperimentalWarning'] },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
})
