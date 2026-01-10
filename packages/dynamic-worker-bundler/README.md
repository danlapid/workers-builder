# dynamic-worker-bundler

A library for bundling and transforming source files into the format required by Cloudflare's [Worker Loader binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) (closed beta). This enables dynamically spawning Workers with arbitrary code at runtime.

## Installation

```bash
npm install dynamic-worker-bundler
```

## Quick Start

```typescript
import { createWorker } from 'dynamic-worker-bundler';

const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      export default {
        async fetch(request: Request): Promise<Response> {
          return new Response('Hello from dynamic worker!');
        }
      }
    `,
  },
});

// Use with Worker Loader binding
const worker = await env.LOADER.get('my-worker', async () => ({
  mainModule,
  modules,
  compatibilityDate: '2025-01-01',
}));

const response = await worker.fetch(request);
```

## Features

- **TypeScript/JSX transformation** - Transforms `.ts`, `.tsx`, `.jsx` files using [Sucrase](https://github.com/alangpierce/sucrase)
- **Module resolution** - Resolves imports using Node.js resolution algorithm with `package.json` exports field support
- **Import rewriting** - Rewrites relative imports to match Worker Loader's expected module paths
- **Optional bundling** - Bundle all dependencies into a single file using [esbuild-wasm](https://esbuild.github.io/)
- **NPM dependency fetching** - Fetch npm packages from [esm.sh](https://esm.sh) CDN at runtime

## API

### `createWorker(options): Promise<CreateWorkerResult>`

The main function that transforms source files into the Worker Loader format.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `files` | `Record<string, string>` | *required* | Input files - keys are paths, values are file contents |
| `entryPoint` | `string` | auto-detected | Entry point path. Auto-detected from `package.json` or defaults to `src/index.ts` |
| `bundle` | `boolean` | `true` | Bundle all dependencies into a single file using esbuild-wasm |
| `externals` | `string[]` | `[]` | Modules that should not be bundled |
| `target` | `string` | `'es2022'` | Target environment for esbuild |
| `minify` | `boolean` | `false` | Minify the output |
| `sourcemap` | `boolean` | `false` | Generate source maps |
| `strictBundling` | `boolean` | `false` | Throw error if bundling fails instead of falling back to transform-only mode |
| `fetchDependencies` | `boolean` | `false` | Fetch missing npm dependencies from CDN |
| `cdnUrl` | `string` | `'https://esm.sh'` | Custom CDN URL for fetching dependencies |

#### Result

```typescript
interface CreateWorkerResult {
  mainModule: string;      // Entry point path for Worker Loader
  modules: Modules;        // All modules in the bundle
  warnings?: string[];     // Any warnings generated during bundling
}
```

## Examples

### Multi-file Project

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { greet } from './utils';
      export default {
        fetch: () => new Response(greet('World'))
      }
    `,
    'src/utils.ts': `
      export function greet(name: string): string {
        return 'Hello, ' + name + '!';
      }
    `,
    'package.json': JSON.stringify({ main: 'src/index.ts' }),
  },
});
```

### With JSON Configuration

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import config from './config.json';
      export default {
        fetch: () => new Response(JSON.stringify(config))
      }
    `,
    'src/config.json': JSON.stringify({ version: '1.0.0', name: 'my-app' }),
    'package.json': JSON.stringify({ main: 'src/index.ts' }),
  },
});
```

### Fetching NPM Dependencies

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/', (c) => c.text('Hello Hono!'));
      export default app;
    `,
    'package.json': JSON.stringify({ main: 'src/index.ts' }),
  },
  fetchDependencies: true,  // Fetches 'hono' from esm.sh
  bundle: false,            // Don't bundle, keep separate modules
});
```

### With Environment Variables

Worker Loader passes bindings to your worker. Access them in your handler:

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      interface Env {
        API_KEY: string;
        KV: KVNamespace;
      }
      
      export default {
        async fetch(request: Request, env: Env): Promise<Response> {
          const value = await env.KV.get('key');
          return new Response('API Key: ' + env.API_KEY);
        }
      }
    `,
    'package.json': JSON.stringify({ main: 'src/index.ts' }),
  },
});

// Pass bindings when creating the worker
const worker = await env.LOADER.get('my-worker', async () => ({
  mainModule,
  modules,
  compatibilityDate: '2025-01-01',
  bindings: {
    API_KEY: 'secret-key',
    KV: env.MY_KV_NAMESPACE,
  },
}));
```

## Advanced Usage

### Transform-only Mode

If bundling fails (e.g., esbuild-wasm not available), the library automatically falls back to transform-only mode. Use `strictBundling: true` to throw an error instead:

```typescript
const result = await createWorker({
  files: { /* ... */ },
  bundle: true,
  strictBundling: true,  // Throws if bundling fails
});
```

### Using Lower-level APIs

The library exports lower-level functions for more control:

```typescript
import {
  transformCode,
  parseImports,
  resolveModule,
  fetchFromCDN,
} from 'dynamic-worker-bundler';

// Transform TypeScript/JSX
const { code, sourceMap } = transformCode('const x: number = 1;', {
  filePath: 'file.ts',
  transforms: ['typescript'],
});

// Parse imports from code
const imports = parseImports(code);

// Resolve module paths
const resolved = resolveModule('./utils', {
  files: { 'utils.ts': '...' },
  importer: 'index.ts',
});

// Fetch from CDN
const { code: fetchedCode, resolvedUrl } = await fetchFromCDN('lodash-es', {
  cdnUrl: 'https://esm.sh',
});
```

## Worker Loader Binding

To use this library, you need access to the Worker Loader binding (currently in closed beta). Configure it in your `wrangler.toml` or `wrangler.jsonc`:

```toml
# wrangler.toml
[[worker_loaders]]
binding = "LOADER"
```

```jsonc
// wrangler.jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

Then use it in your Worker:

```typescript
interface Env {
  LOADER: WorkerLoader;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { mainModule, modules } = await createWorker({
      files: { /* ... */ },
    });
    
    const worker = await env.LOADER.get('worker-name', async () => ({
      mainModule,
      modules,
      compatibilityDate: '2025-01-01',
    }));
    
    return worker.fetch(request);
  }
}
```

## How It Works

1. **Entry Point Detection** - Finds the entry point from `package.json` main/module fields or defaults to `src/index.ts`
2. **Transformation** - Transforms TypeScript/JSX files to JavaScript using Sucrase
3. **Import Resolution** - Resolves and rewrites imports to absolute paths
4. **Bundling** (optional) - Bundles all dependencies using esbuild-wasm
5. **Module Formatting** - Outputs modules in the format expected by Worker Loader

## Limitations

- **No Node.js built-ins** - Worker runtime doesn't have Node.js APIs
- **esbuild-wasm performance** - WASM version is slower than native esbuild
- **CDN dependencies** - `fetchDependencies` requires network access and adds latency

## License

MIT
