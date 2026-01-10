# dynamic-worker-bundler

Bundle source files for Cloudflare's [Worker Loader binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) (closed beta). Dynamically spawn Workers at runtime.

## Installation

```bash
npm install dynamic-worker-bundler
```

## Usage

```typescript
import { createWorker } from 'dynamic-worker-bundler';

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
| `externals` | `string[]` | `[]` | Modules to exclude from bundle |
| `minify` | `boolean` | `false` | Minify output |
| `sourcemap` | `boolean` | `false` | Generate inline source maps |

### Returns

```typescript
{
  mainModule: string;              // Entry point path
  modules: Record<string, string>; // All modules
  wranglerConfig?: {               // Parsed from wrangler.toml/json/jsonc
    main?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
  };
  warnings?: string[];
}
```

**Entry point detection order:** `entryPoint` option → wrangler `main` → package.json → defaults (`src/index.ts`, etc.)

**`wranglerConfig`:** `undefined` if no config file, `{}` if file exists but empty, or contains parsed fields.

## Features

**TypeScript/JSX** — Transforms `.ts`, `.tsx`, `.jsx` via Sucrase

**npm dependencies** — Auto-installs from registry when `package.json` has dependencies

**Wrangler config** — Parses `wrangler.toml`, `wrangler.json`, or `wrangler.jsonc`

**Bundling** — Uses esbuild-wasm with transform-only fallback

## Examples

### With Dependencies

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

## License

MIT
