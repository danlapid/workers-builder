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
├── workers-builder/   # Main library
│   └── src/
│       ├── index.ts          # createWorker() orchestration + exports
│       ├── bundler.ts        # esbuild-wasm bundling
│       ├── config.ts         # Wrangler config parsing
│       ├── installer.ts      # npm package installation
│       ├── resolver.ts       # Module resolution
│       ├── transformer.ts    # TypeScript/JSX transform + transform-only mode
│       ├── types.ts          # TypeScript interfaces
│       └── utils.ts          # Entry point detection
├── tests/                    # Vitest + workerd tests
└── examples/basic/           # Interactive playground
```

## Architecture

```
createWorker(options)
│
├─ parseWranglerConfig()      # config.ts - Parse wrangler.toml/json/jsonc
│
├─ hasDependencies()?         # installer.ts - Check package.json
│  └─ installDependencies()   # Fetch from npm, extract tarballs
│
├─ detectEntryPoint()         # utils.ts - option > wrangler > package.json > defaults
│
└─ bundle?
   ├─ bundleWithEsbuild()     # bundler.ts - esbuild-wasm with virtual FS
   └─ transformAndResolve()   # transformer.ts - Sucrase + import rewriting
```

## Source Files

| File | Purpose |
|------|---------|
| `index.ts` | Main `createWorker()` function, orchestrates the pipeline |
| `bundler.ts` | esbuild-wasm bundling with virtual filesystem plugin |
| `config.ts` | Parses wrangler.toml/json/jsonc, extracts compatibility settings |
| `installer.ts` | Fetches npm packages, resolves semver, extracts tarballs |
| `resolver.ts` | Node.js-style module resolution, package.json exports field |
| `transformer.ts` | Sucrase transforms + `transformAndResolve()` for bundle:false mode |
| `types.ts` | Public TypeScript interfaces |
| `utils.ts` | `detectEntryPoint()` - entry point detection from various sources |

## Key Implementation Details

**esbuild-wasm**: Uses a virtual filesystem plugin to resolve imports from the in-memory `files` object. Initialized lazily on first use.

**npm installation**: Fetches package metadata, resolves semver ranges, downloads tarballs, extracts via `DecompressionStream`. Installs dependencies in parallel.

**Transform-only mode** (`bundle: false`): Processes files individually with Sucrase, rewrites import paths to match output structure. Used when bundling isn't needed.

**nodejs_compat**: When wrangler config has `nodejs_compat` flag, esbuild uses `platform: 'node'` instead of `platform: 'browser'`.

## Testing

Tests run in workerd via `@cloudflare/vitest-pool-workers`:

- `bundler.test.ts` — Unit tests for transform, resolution, config parsing
- `hono-starter.test.ts` — E2E tests with real npm dependencies (Hono)
