# workers-builder

Bundle source files for Cloudflare's [Worker Loader binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) (closed beta). Perfect for AI coding agents that need to dynamically generate and deploy javascript code with real npm dependencies.

## Installation

```bash
npm install workers-builder
```

## Quick Start

Just provide your source code and dependencies — no config files needed:

```typescript
import { createWorker } from 'workers-builder';

const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { Hono } from 'hono';
      import { cors } from 'hono/cors';

      const app = new Hono();
      app.use('*', cors());
      app.get('/', (c) => c.text('Hello from Hono!'));
      app.get('/json', (c) => c.json({ message: 'It works!' }));

      export default app;
    `,
    'package.json': JSON.stringify({
      dependencies: {
        hono: '^4.0.0'
      }
    }),
  },
});

// Use with Worker Loader binding
const worker = env.LOADER.get('my-worker', async () => ({
  mainModule,
  modules,
  compatibilityDate: '2026-01-01',
}));

await worker.getEntrypoint().fetch(request);
```

The library automatically:
- Detects your entry point (`src/index.ts` by default)
- Fetches and installs npm dependencies from the registry
- Bundles everything with esbuild
- Returns modules ready for the Worker Loader binding

## API

### `createWorker(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `files` | `Record<string, string>` | *required* | Source files (path → content) |
| `entryPoint` | `string` | auto | Override entry point detection |
| `bundle` | `boolean` | `true` | Bundle into single file |
| `externals` | `string[]` | `[]` | Additional modules to exclude (`cloudflare:*` always excluded) |
| `minify` | `boolean` | `false` | Minify output |
| `sourcemap` | `boolean` | `false` | Generate inline source maps |
| `registry` | `string` | `'https://registry.npmjs.org'` | npm registry URL |

### Returns

```typescript
{
  mainModule: string;              // Entry point path
  modules: Record<string, string>; // All output modules
  wranglerConfig?: {               // Parsed from wrangler.toml/json/jsonc
    main?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
  };
  warnings?: string[];             // Any warnings during bundling
}
```

### Entry Point Detection

Priority order:
1. `entryPoint` option
2. `main` field in wrangler config
3. `exports`, `module`, or `main` field in package.json
4. Default paths: `src/index.ts`, `src/index.js`, `index.ts`, `index.js`

## More Examples

### Multiple Dependencies

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { Hono } from 'hono';
      import { zValidator } from '@hono/zod-validator';
      import { z } from 'zod';

      const app = new Hono();

      const schema = z.object({ name: z.string() });

      app.post('/greet', zValidator('json', schema), (c) => {
        const { name } = c.req.valid('json');
        return c.json({ message: \`Hello, \${name}!\` });
      });

      export default app;
    `,
    'package.json': JSON.stringify({
      dependencies: {
        hono: '^4.0.0',
        '@hono/zod-validator': '^0.4.0',
        zod: '^3.23.0'
      }
    }),
  },
});
```

### With Wrangler Config

For projects that need specific compatibility settings or are migrating from existing Workers:

```typescript
const { mainModule, modules, wranglerConfig } = await createWorker({
  files: {
    'src/index.ts': `
      export default {
        fetch: () => new Response('Hello!')
      }
    `,
    'wrangler.toml': `
      main = "src/index.ts"
      compatibility_date = "2026-01-01"
      compatibility_flags = ["nodejs_compat"]
    `,
  },
});

const worker = env.LOADER.get('my-worker', async () => ({
  mainModule,
  modules,
  compatibilityDate: wranglerConfig?.compatibilityDate ?? '2026-01-01',
  compatibilityFlags: wranglerConfig?.compatibilityFlags,
}));
```

### Transform-only Mode

Skip bundling to preserve module structure:

```typescript
const { mainModule, modules } = await createWorker({
  files: { /* ... */ },
  bundle: false,
});
```

## Worker Loader Setup

```toml
# wrangler.toml (host worker)
[[worker_loaders]]
binding = "LOADER"
```

```typescript
interface Env {
  LOADER: WorkerLoader;
}
```

## Future Work

- **Lockfile support**: Read `package-lock.json` / `pnpm-lock.yaml` for deterministic installs

## License

MIT
