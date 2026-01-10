# AGENTS.md - Developer Documentation

## Overview

**dynamic-worker-bundler** bundles source files for Cloudflare's Worker Loader binding, enabling dynamic Worker spawning at runtime.

## Repository Structure

```
dynamic-worker-bundler/
├── packages/
│   ├── dynamic-worker-bundler/     # Main library
│   │   ├── src/
│   │   │   ├── index.ts            # Public exports (createWorker + types)
│   │   │   ├── bundler.ts          # Main createWorker() orchestration
│   │   │   ├── installer.ts        # npm package fetching & extraction
│   │   │   ├── transformer.ts      # TypeScript/JSX transformation (Sucrase)
│   │   │   ├── resolver.ts         # Module resolution & import parsing
│   │   │   └── types.ts            # TypeScript interfaces
│   │   └── dist/                   # Built output
│   │
│   └── tests/                      # Test package (vitest + workerd)
│       ├── src/
│       │   ├── bundler.test.ts     # Unit tests for createWorker
│       │   └── hono-starter.test.ts # E2E tests with real npm deps
│       └── vitest.config.ts
│
├── examples/basic/                 # Interactive playground
└── biome.json                      # Linting config
```

## Commands

```bash
pnpm install        # Install dependencies
pnpm run build      # Build the library  
pnpm run test       # Run tests
pnpm run check      # Lint/format check
```

## Architecture

```
createWorker(options)
├── hasDependencies(files)?
│   └── installDependencies()      # Fetch from npm registry
│       ├── fetchPackageMetadata() # Get package info
│       ├── resolveVersion()       # Resolve semver
│       └── fetchPackageFiles()    # Download & extract tarball
│
├── detectEntryPoint(files)        # From package.json or defaults
│
└── bundle: true?
    ├── bundleWithEsbuild()        # Single file output
    │   └── virtualFsPlugin        # In-memory file resolution
    │
    └── (fallback) transformAndResolve()
        ├── parseImports()         # Find dependencies  
        ├── resolveModule()        # Resolve paths
        └── transformCode()        # TS/JSX → JS
```

## Source Files

### `bundler.ts`
Main orchestration. Key functions:
- `createWorker()` - Public API entry point
- `hasDependencies()` - Check if package.json has deps
- `detectEntryPoint()` - Find entry from package.json or defaults
- `bundleWithEsbuild()` - esbuild-wasm bundling with virtual FS plugin
- `transformAndResolve()` - Transform-only mode (no bundling)
- `rewriteImports()` - Rewrite import paths to absolute

### `installer.ts`
Fetches npm packages into virtual `node_modules/`:
- `installDependencies()` - Main entry, handles transitive deps
- `fetchPackageMetadata()` - GET from registry.npmjs.org
- `resolveVersion()` - Simple semver resolution (^, ~, exact)
- `fetchPackageFiles()` - Download tarball, extract with DecompressionStream
- `parseTar()` - Custom tar parser for .tgz extraction

### `transformer.ts`
TypeScript/JSX transformation via Sucrase:
- `transformCode()` - Main transform function
- `isTypeScriptFile()` - Check .ts/.tsx/.mts
- `isJavaScriptFile()` - Check .js/.jsx/.mjs
- `getOutputPath()` - .ts → .js, .mts → .mjs

### `resolver.ts`
Node.js-style module resolution:
- `resolveModule()` - Resolve import specifier to file path
- `parseImports()` - Regex-based import extraction
- Uses `resolve.exports` for package.json exports field

### `types.ts`
```typescript
interface CreateWorkerOptions {
  files: Record<string, string>;
  entryPoint?: string;
  bundle?: boolean;        // default: true
  externals?: string[];
  target?: string;         // default: 'es2022'
  minify?: boolean;        // default: false
  sourcemap?: boolean;     // default: false (bundle mode only)
}

interface CreateWorkerResult {
  mainModule: string;
  modules: Record<string, string | Module>;
  warnings?: string[];
}
```

## Key Design Decisions

### Why npm registry over esm.sh CDN?
esm.sh had issues with transitive dependencies. Direct npm registry fetch works reliably in transform-only mode.

### Why Sucrase over Babel/TypeScript?
Sucrase is pure JS (no WASM), ~20x faster than Babel, and sufficient for type stripping + JSX transform.

### Why transform-only fallback?
esbuild-wasm requires WASM compilation which can fail in some environments. Sucrase-based transform always works.

### Why virtual file system?
Worker Loader expects modules as strings. Users provide code from various sources. No filesystem in Workers.

## Testing

Tests run in workerd via `@cloudflare/vitest-pool-workers`:

- **bundler.test.ts** - Unit tests for TypeScript transform, module resolution, import rewriting
- **hono-starter.test.ts** - E2E tests that actually fetch hono from npm and verify the full pipeline

```bash
pnpm run test  # Builds library first, then runs tests
```

## Known Limitations

1. **esbuild-wasm** - Can fail in wrangler dev; falls back to transform-only
2. **No Node.js APIs** - fs, path, etc. not available in Workers
3. **npm latency** - First install requires network fetch
4. **Memory** - Large packages may exceed Worker limits
5. **Sourcemaps** - Only work in bundle mode

## Public API

Only exports:
- `createWorker` - Main function
- `CreateWorkerOptions` - Options type
- `CreateWorkerResult` - Result type  
- `Files` - Input files type
- `Modules` - Output modules type
