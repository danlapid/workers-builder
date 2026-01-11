import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  // Force Vite to re-bundle dependencies on each run
  // This ensures changes to workers-builder are picked up
  cacheDir: '.vite-test-cache',
  optimizeDeps: {
    force: true,
  },
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['workers-builder'],
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
