import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/**/src/**/*.test.ts', 'apps/orchestrator/src/**/*.test.ts'],
        },
      },
      './apps/desktop/vitest.config.ts',
      {
        // Real services (a regtest bitcoind); slower, and skipped when no verified runtime is installed.
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
