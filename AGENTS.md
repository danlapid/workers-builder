# Developer Documentation

## Overview

Bundles source files for Cloudflare's Worker Loader binding, enabling dynamic Worker spawning at runtime.

## Commands

```bash
pnpm install        # Install dependencies
pnpm run build      # Build the library
pnpm run test       # Run tests
pnpm run check      # Lint/format check
```

## Repository Structure

```
packages/
├── dynamic-worker-bundler/   # Main library
│   └── src/
│       ├── index.ts          # Public exports
│       ├── bundler.ts        # Main createWorker() orchestration
│       ├── config.ts         # Wrangler config parsing
│       ├── installer.ts      # npm package fetching
│       ├── resolver.ts       # Module resolution
│       ├── transformer.ts    # TypeScript/JSX transform
│       └── types.ts          # TypeScript interfaces
├── tests/                    # Vitest + workerd tests
└── examples/basic/           # Interactive playground
```

## Architecture

```
createWorker(options)
│
├─ parseWranglerConfig()      # Parse wrangler.toml/json/jsonc
│
├─ installDependencies()?     # If package.json has dependencies
│  └─ Fetch from npm registry, extract tarballs
│
├─ detectEntryPoint()         # Priority: option > wrangler main > package.json > defaults
│
└─ bundle?
   ├─ bundleWithEsbuild()     # esbuild-wasm with virtual FS plugin
   └─ transformAndResolve()   # Fallback: Sucrase transform + import rewriting
```

## Source Files

### bundler.ts
Main orchestration: `createWorker()`, entry point detection, esbuild bundling, transform fallback.

### config.ts
Parses `wrangler.toml` (smol-toml), `wrangler.json`, `wrangler.jsonc`. Extracts `main`, `compatibility_date`, `compatibility_flags`.

### installer.ts
Fetches npm packages: metadata lookup, semver resolution, tarball extraction via `DecompressionStream`.

### transformer.ts
Sucrase-based TypeScript/JSX transform. Pure JS, no WASM dependency.

### resolver.ts
Node.js-style module resolution. Uses `resolve.exports` for package.json exports field.

## Key Types

```typescript
interface CreateWorkerOptions {
  files: Record<string, string>;
  entryPoint?: string;
  bundle?: boolean;        // default: true
  externals?: string[];
  target?: string;         // default: 'es2022'
  minify?: boolean;
  sourcemap?: boolean;
}

interface WranglerConfig {
  main?: string;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
}

interface CreateWorkerResult {
  mainModule: string;
  modules: Record<string, string | Module>;
  wranglerConfig?: WranglerConfig;
  warnings?: string[];
}
```

## Testing

Tests run in workerd via `@cloudflare/vitest-pool-workers`:

- `bundler.test.ts` — Unit tests for transform, resolution, config parsing
- `hono-starter.test.ts` — E2E tests with real npm dependencies


## Public Exports

```typescript
export { createWorker } from './bundler.js';
export type {
  CreateWorkerOptions,
  CreateWorkerResult,
  Files,
  Modules,
  WranglerConfig
} from './types.js';
```
