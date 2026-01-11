# workers-builder

Bundle source files for Cloudflare's [Worker Loader binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) (closed beta).

## Installation

```bash
npm install workers-builder
```

## Quick Start

```typescript
import { createWorker } from 'workers-builder';

const { mainModule, modules, wranglerConfig } = await createWorker({
  files: {
    'src/index.ts': `
      export default {
        fetch: () => new Response('Hello!')
      }
    `,
    'wrangler.toml': `
      main = "src/index.ts"
      compatibility_date = "2024-01-01"
    `,
  },
});

// Use with Worker Loader binding
const worker = env.LOADER.get('my-worker', async () => ({
  mainModule,
  modules,
  compatibilityDate: wranglerConfig?.compatibilityDate ?? '2024-01-01',
  compatibilityFlags: wranglerConfig?.compatibilityFlags,
}));

await worker.getEntrypoint().fetch(request);
```

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

## Examples

### With npm Dependencies

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/', (c) => c.text('Hello!'));
      export default app;
    `,
    'package.json': JSON.stringify({
      dependencies: { hono: '^4.0.0' }
    }),
  },
});
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
# wrangler.toml
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
