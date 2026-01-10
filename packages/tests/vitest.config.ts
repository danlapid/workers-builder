import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["dynamic-worker-bundler"],
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
