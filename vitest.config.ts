import { defineConfig } from 'vitest/config';

// The "source" export condition points workspace packages at their TypeScript
// sources, so tests run without building first.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
