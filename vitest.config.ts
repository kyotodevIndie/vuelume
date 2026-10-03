import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests import workspace packages from source, so `pnpm test` does not require a build.
const packagesDir = fileURLToPath(new URL('./packages', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{ find: /^@vuelume\/(.*)$/, replacement: `${packagesDir}/$1/src/index.ts` }],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
  },
})
