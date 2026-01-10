import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  // Force Vite to re-bundle dependencies on each run
  // This ensures changes to dynamic-worker-bundler are picked up
  cacheDir: '.vite-test-cache',
  optimizeDeps: {
    force: true,
  },
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['dynamic-worker-bundler'],
        },
      },
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
