# AGENTS.md - Project Context for AI Assistants

## Project Overview

**dynamic-worker-bundler** is a library that simplifies using Cloudflare's Worker Loader binding (currently in closed beta). The Worker Loader binding allows dynamically spawning Workers with arbitrary code at runtime. This library provides a higher-level `createWorker()` function that takes source files and produces the required `mainModule` and `modules` format expected by the binding.

**Repository:** `danlapid/dynamic-worker-bundler`
**Package name:** `dynamic-worker-bundler`
**License:** MIT

## Repository Structure

```
dynamic-worker-bundler/
├── packages/
│   ├── dynamic-worker-bundler/     # Main library
│   │   ├── src/
│   │   │   ├── index.ts            # Public exports
│   │   │   ├── bundler.ts          # Main createWorker() function
│   │   │   ├── installer.ts        # npm package installer (fetches from registry)
│   │   │   ├── transformer.ts      # TypeScript/JSX transformation (Sucrase)
│   │   │   ├── resolver.ts         # Module resolution & import parsing
│   │   │   └── types.ts            # TypeScript interfaces
│   │   ├── dist/                   # Built output (gitignored)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── tests/                      # Test package
│       ├── src/
│       │   ├── bundler.test.ts     # Unit tests
│       │   ├── integration.test.ts # Integration tests (GitHub + npm)
│       │   ├── hono-starter.test.ts # E2E tests for Hono starter
│       │   └── e2e.test.ts         # End-to-end tests (requires playground)
│       ├── wrangler.toml
│       └── vitest.config.ts
│
├── examples/
│   └── basic/                      # Interactive web playground
│       ├── public/                 # Frontend assets
│       └── src/index.ts            # Worker: serves assets + API endpoints
│
├── .github/workflows/
│   ├── ci.yml                      # CI: lint, typecheck, test
│   └── release.yml                 # Automated release with OIDC publishing
│
├── package.json                    # Root monorepo config
├── pnpm-workspace.yaml
└── biome.json                      # Linting/formatting config
```

## Core Concepts

### Worker Loader Binding

The Worker Loader binding (Cloudflare closed beta) allows creating Workers dynamically at runtime:

```typescript
const worker = env.LOADER.get('worker-name', async () => ({
  mainModule: 'src/index.js',
  modules: {
    'src/index.js': 'export default {...}',
    'node_modules/hono/dist/index.js': '...',
  },
  compatibilityDate: '2026-01-01',
}));

const response = await worker.getEntrypoint().fetch(request);
```

### What This Library Does

`createWorker()` takes source files (TypeScript, JSX, etc.) and:

1. **Detects entry point** from `package.json` or defaults to `src/index.ts`
2. **Auto-installs npm dependencies** if `package.json` has dependencies - downloads packages from npm registry
3. **Transforms TypeScript/JSX** to JavaScript using Sucrase
4. **Resolves and rewrites imports** to match Worker Loader's expected paths
5. **Optionally bundles** everything with esbuild-wasm into a single file

```typescript
import { createWorker } from 'dynamic-worker-bundler';

const { mainModule, modules } = await createWorker({
  files: {
    'src/index.ts': `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/', (c) => c.text('Hello Hono!'));
      export default app;
    `,
    'package.json': JSON.stringify({
      main: 'src/index.ts',
      dependencies: { 'hono': '^4.0.0' }
    }),
  },
  bundle: false,
});
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `sucrase` | Fast TypeScript/JSX transformation (pure JS, no WASM) |
| `resolve.exports` | package.json exports field resolution |
| `esbuild-wasm` | Optional bundling (WASM version for Workers compatibility) |

## Commands

```bash
pnpm install              # Install all dependencies
pnpm run build            # Build the library
pnpm run test             # Run tests
pnpm run check            # Run Biome lint/format check
pnpm run example          # Run the interactive playground
```

## Source Code Details

### `bundler.ts` - Main Entry Point

- `createWorker(options)` - Main function that orchestrates the pipeline
- `detectEntryPoint(files)` - Finds entry point from package.json or defaults
- `transformAndResolve(...)` - Transform-only mode (no bundling)
- `bundleWithEsbuild(...)` - Full bundling with esbuild-wasm

**Bundling modes:**

1. **Bundle mode** (`bundle: true`, default): Uses esbuild-wasm to bundle everything into one file
2. **Transform mode** (`bundle: false`): Transforms each file individually, keeps separate modules

If esbuild fails, it falls back to transform mode. Use `strictBundling: true` to throw instead.

### `installer.ts` - npm Package Installer

Fetches and extracts npm packages into a virtual `node_modules/` directory:

- `installDependencies(files, options)` - Main install function
- Downloads tarballs from npm registry
- Extracts using `DecompressionStream` and custom tar parser
- Handles transitive dependencies recursively

### `transformer.ts` - TypeScript/JSX Transformation

Uses **Sucrase** for fast transformation (20x faster than Babel, pure JS):

- `transformCode(code, options)` - Main transform function
- `isTypeScriptFile(path)` - Check if `.ts`, `.tsx`, `.mts`
- `getOutputPath(path)` - `.ts` -> `.js`, `.mts` -> `.mjs`

### `resolver.ts` - Module Resolution

Handles Node.js-style module resolution:

- `resolveModule(specifier, options)` - Main resolution function
- `parseImports(code)` - Regex-based import parsing

### `types.ts` - TypeScript Interfaces

```typescript
interface CreateWorkerOptions {
  files: Record<string, string>;
  entryPoint?: string;
  bundle?: boolean;           // default: true
  externals?: string[];
  target?: string;            // default: 'es2022'
  minify?: boolean;           // default: false
  sourcemap?: boolean;        // default: false
  strictBundling?: boolean;   // default: false
}

interface CreateWorkerResult {
  mainModule: string;
  modules: Record<string, string>;
  warnings?: string[];
}
```

## Testing

Tests use Vitest with `@cloudflare/vitest-pool-workers`.

**Test files:**
- `bundler.test.ts` - Unit tests for createWorker function
- `hono-starter.test.ts` - Full E2E tests with Hono starter template

## Known Limitations

1. **esbuild-wasm in Workers** - WASM initialization can fail in wrangler dev; library falls back to transform-only mode
2. **No Node.js built-ins** - Worker runtime doesn't have Node.js APIs
3. **npm registry latency** - Dependency installation adds network latency for first fetch
4. **Large packages** - Very large npm packages may hit memory limits

## Architecture Decisions

### Why npm registry instead of esm.sh?

Initially tried esm.sh CDN but it had problems with transitive dependencies and required WASM bundling. Fetching from npm registry directly works in transform-only mode without WASM.

### Why transform-only mode as fallback?

esbuild-wasm requires WASM compilation, which can fail in various environments. Transform-only mode uses Sucrase (pure JavaScript) and works everywhere.

### Why virtual file system?

The library operates on a `Files` object (`Record<string, string>`) because:
- Worker Loader expects modules as strings
- Users may provide code from various sources
- Enables running in Workers without file system access
