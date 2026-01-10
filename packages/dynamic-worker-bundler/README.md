# dynamic-worker-bundler

Bundle and transform source files for Cloudflare's [Worker Loader binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) (closed beta). Dynamically spawn Workers with arbitrary code at runtime.

## Installation

```bash
npm install dynamic-worker-bundler
```

## Quick Start

```typescript
import { createWorker } from 'dynamic-worker-bundler';

// Bundle your source files
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      export default {
        fetch: () => new Response('Hello from dynamic worker!')
      }
    `,
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

## Features

- **TypeScript/JSX** - Transforms `.ts`, `.tsx`, `.jsx` using Sucrase
- **npm dependencies** - Auto-installs packages from npm registry when `package.json` has dependencies  
- **Bundling** - Bundles everything into a single file with esbuild-wasm (with transform-only fallback)
- **Module resolution** - Resolves imports with `package.json` exports support

## API

### `createWorker(options): Promise<CreateWorkerResult>`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `files` | `Record<string, string>` | *required* | Source files (path → content) |
| `entryPoint` | `string` | auto-detected | Entry point path |
| `bundle` | `boolean` | `true` | Bundle into single file |
| `externals` | `string[]` | `[]` | Modules to exclude from bundle |
| `minify` | `boolean` | `false` | Minify output |
| `sourcemap` | `boolean` | `false` | Generate inline source maps |

Returns `{ mainModule, modules, warnings? }`.

## Examples

### With npm Dependencies

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/', (c) => c.text('Hello Hono!'));
      export default app;
    `,
    'package.json': JSON.stringify({
      dependencies: { hono: '^4.0.0' }
    }),
  },
});
```

### Multi-file Project

```typescript
const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { greet } from './utils';
      export default { fetch: () => new Response(greet('World')) }
    `,
    'src/utils.ts': `
      export const greet = (name: string) => 'Hello, ' + name + '!';
    `,
  },
});
```

### Transform-only Mode

Skip bundling to keep modules separate:

```typescript
const { mainModule, modules } = await createWorker({
  files: { /* ... */ },
  bundle: false,
});
// modules contains individual transformed files
```

## Worker Loader Setup

Configure the binding in `wrangler.toml`:

```toml
[[worker_loaders]]
binding = "LOADER"
```

Then use in your Worker:

```typescript
interface Env {
  LOADER: WorkerLoader;
}

export default {
  async fetch(request: Request, env: Env) {
    const { mainModule, modules } = await createWorker({ files: { /* ... */ } });
    
    const worker = env.LOADER.get('worker-name', async () => ({
      mainModule,
      modules,
      compatibilityDate: '2026-01-01',
    }));
    
    return worker.getEntrypoint().fetch(request);
  }
}
```

## Limitations

- **No Node.js built-ins** - Worker runtime doesn't have `fs`, `path`, etc.
- **Memory limits** - Very large npm packages may exceed Worker memory
- **Network latency** - First dependency install requires npm registry fetch

## License

MIT
