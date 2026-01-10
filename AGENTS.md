# AGENTS.md - Project Context for AI Assistants

## Project Overview

**dynamic-worker-bundler** is a library that simplifies using Cloudflare's Worker Loader binding (currently in closed beta). The Worker Loader binding allows dynamically spawning Workers with arbitrary code at runtime. This library provides a higher-level `createWorker()` function that takes source files and produces the required `mainModule` and `modules` format expected by the binding.

**Repository:** `danlapid/dynamic-worker-bundler`
**Package name:** `dynamic-worker-bundler`
**Current version:** `0.0.1`
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
│   │   │   ├── fetcher.ts          # Legacy CDN utilities (esm.sh)
│   │   │   └── types.ts            # TypeScript interfaces
│   │   ├── dist/                   # Built output (gitignored)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   └── tests/                      # Test package
│       ├── src/
│       │   ├── index.ts            # Empty worker entry (required by vitest)
│       │   ├── bundler.test.ts     # Unit tests
│       │   ├── integration.test.ts # Integration tests (GitHub + npm)
│       │   └── e2e.test.ts         # End-to-end tests (requires playground)
│       ├── wrangler.toml
│       ├── vitest.config.ts
│       └── package.json
│
├── examples/
│   └── basic/                      # Interactive web playground
│       ├── public/
│       │   ├── index.html          # Main HTML structure
│       │   ├── styles.css          # Catppuccin-themed dark mode
│       │   └── app.js              # Frontend JavaScript
│       ├── src/
│       │   └── index.ts            # Worker: serves assets + API endpoints
│       ├── wrangler.jsonc
│       └── package.json
│
├── scripts/
│   └── publish.mjs                 # OIDC-enabled npm publishing
│
├── .changeset/
│   ├── config.json                 # Changesets configuration
│   └── README.md                   # Changesets usage docs
│
├── .github/workflows/
│   ├── ci.yml                      # CI: changeset-check, lint, typecheck, test
│   └── release.yml                 # Automated release with OIDC publishing
│
├── package.json                    # Root monorepo config
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json                      # Linting/formatting config
└── AGENTS.md                       # This file
```

## Core Concepts

### Worker Loader Binding

The Worker Loader binding (Cloudflare closed beta) allows creating Workers dynamically at runtime:

```typescript
// The binding expects this format:
const worker = env.LOADER.get('worker-name', async () => ({
  mainModule: 'src/index.js',           // Entry point path
  modules: {                             // All modules as key-value pairs
    'src/index.js': 'export default {...}',
    'src/utils.js': 'export function...',
    'node_modules/hono/dist/index.js': '...',
  },
  compatibilityDate: '2025-01-01',
  env: { /* optional bindings */ },
  globalOutbound: null,
}));

const response = await worker.getEntrypoint().fetch(request);
```

### What This Library Does

`createWorker()` takes source files (TypeScript, JSX, etc.) and:

1. **Detects entry point** from `package.json` or defaults to `src/index.ts`
2. **Installs npm dependencies** (if `fetchDependencies: true`) - downloads packages from npm registry
3. **Transforms TypeScript/JSX** to JavaScript using Sucrase
4. **Resolves and rewrites imports** to match Worker Loader's expected paths
5. **Optionally bundles** everything with esbuild-wasm into a single file

```typescript
import { createWorker } from 'dynamic-worker-bundler';

const { mainModule, modules, warnings } = await createWorker({
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
  fetchDependencies: true,  // Install npm packages from registry
  bundle: false,            // false = keep separate modules (works in transform-only mode)
});

// Result:
// mainModule: 'src/index.js'
// modules: {
//   'src/index.js': '...',
//   'node_modules/hono/dist/index.js': '...',
//   'node_modules/hono/dist/hono.js': '...',
//   ... (26+ hono modules)
// }
```

## How Dependency Installation Works

When `fetchDependencies: true`, the library performs an npm-install-like operation:

1. **Read `package.json`** from the virtual files to get `dependencies`
2. **Fetch package metadata** from npm registry (`registry.npmjs.org`)
3. **Resolve semver versions** (handles `^`, `~`, `>=`, exact versions, dist-tags)
4. **Download tarballs** (`.tgz` files) from npm
5. **Extract packages** using `DecompressionStream` (gzip) and custom tar parser
6. **Handle transitive dependencies** recursively
7. **Populate virtual `node_modules/`** with extracted files

This is similar to running `npm install` but operates entirely in memory with a virtual file system.

## Dependencies

### Library Dependencies (`packages/dynamic-worker-bundler/`)

| Package | Purpose |
|---------|---------|
| `sucrase` | Fast TypeScript/JSX transformation (pure JS, no WASM) |
| `es-module-lexer` | Fast import parsing (WASM-based, with regex fallback) |
| `resolve.exports` | package.json exports field resolution |
| `esbuild-wasm` | Optional bundling (WASM version for Workers compatibility) |

### Dev Dependencies (root)

| Package | Purpose |
|---------|---------|
| `@biomejs/biome` | Linting and formatting |
| `@changesets/cli` | Version management and changelog generation |
| `@changesets/changelog-github` | GitHub-linked changelogs |

## Commands

```bash
# Development
pnpm install              # Install all dependencies
pnpm run build            # Build the library
pnpm run dev              # Watch mode build
pnpm run check            # Run Biome lint/format check
pnpm run check:fix        # Auto-fix lint/format issues
pnpm run test             # Run tests (builds first)
pnpm run test:watch       # Watch mode tests
pnpm run typecheck        # TypeScript type checking
pnpm run generate-types   # Generate wrangler types for all packages

# Example app
pnpm run example          # Run the interactive playground (builds first)
# Or: cd examples/basic && pnpm wrangler dev

# Release
pnpm changeset            # Create a new changeset
pnpm version-packages     # Apply changesets (bump versions)
pnpm release              # Build, test, and publish
pnpm ci:publish           # Used by CI (OIDC publishing)
```

## Source Code Details

### `bundler.ts` - Main Entry Point

**Key functions:**

- `createWorker(options)` - Main function that orchestrates the pipeline
- `detectEntryPoint(files)` - Finds entry point from package.json or defaults
- `transformAndResolve(...)` - Transform-only mode (no bundling)
- `bundleWithEsbuild(...)` - Full bundling with esbuild-wasm
- `rewriteImports(...)` - Rewrites import paths to match output paths

**Bundling modes:**

1. **Bundle mode** (`bundle: true`, default): Uses esbuild-wasm to bundle everything into one file (`bundle.js`)
2. **Transform mode** (`bundle: false`): Transforms each file individually, keeps separate modules

**Fallback behavior:**
- If `bundle: true` but esbuild fails (e.g., WASM can't initialize), it falls back to transform mode (with warning)
- Use `strictBundling: true` to throw instead of falling back
- Transform mode works reliably in all environments

### `installer.ts` - npm Package Installer

Fetches and extracts npm packages into a virtual `node_modules/` directory.

**Key functions:**
- `installDependencies(files, options)` - Main install function
- `fetchPackageMetadata(name, registry)` - Get package info from npm
- `resolveVersion(range, metadata)` - Resolve semver range to specific version
- `fetchPackageFiles(name, metadata)` - Download and extract tarball
- `extractTarball(data)` - Decompress gzip and parse tar archive

**Flow:**
```
package.json → parse dependencies → fetch metadata → resolve versions
    → download tarballs → extract to node_modules/ → process transitive deps
```

### `transformer.ts` - TypeScript/JSX Transformation

Uses **Sucrase** for fast transformation:
- 20x faster than Babel
- Pure JavaScript (no WASM needed)
- Strips type annotations
- Transforms JSX to `jsx()` calls

**Key functions:**
- `transformCode(code, options)` - Main transform function
- `isTypeScriptFile(path)` - Check if `.ts`, `.tsx`, `.mts`
- `isJsxFile(path)` - Check if `.jsx`, `.tsx`
- `isJavaScriptFile(path)` - Check if any JS/TS file
- `getOutputPath(path)` - `.ts` -> `.js`, `.mts` -> `.mjs`

### `resolver.ts` - Module Resolution

Handles Node.js-style module resolution:
- Relative imports (`./utils`, `../lib`)
- Bare imports (`hono`, `lodash/debounce`)
- package.json exports field (via `resolve.exports`)
- Extension resolution (`.ts`, `.tsx`, `.js`, etc.)
- Index file resolution (`./utils` -> `./utils/index.ts`)
- node_modules resolution (`hono` -> `node_modules/hono/dist/index.js`)

**Key functions:**
- `resolveModule(specifier, options)` - Main resolution function
- `parseImports(code)` - Regex-based import parsing (sync)
- `parseImportsAsync(code)` - es-module-lexer parsing (async, faster)

### `fetcher.ts` - Legacy CDN Utilities

Contains utilities for esm.sh CDN (legacy, not used in main flow):

**Key functions:**
- `fetchFromCDN(specifier, cdnUrl)` - Fetch package from CDN
- `resolveEsmShImports(code, cdnUrl)` - Convert relative CDN paths to absolute
- `parsePackageSpecifier(specifier)` - Parse `lodash@4.17.21/debounce`

### `types.ts` - TypeScript Interfaces

```typescript
type Files = Record<string, string>;  // path -> content

interface CreateWorkerOptions {
  files: Files;
  entryPoint?: string;
  bundle?: boolean;           // default: true
  externals?: string[];
  target?: string;            // default: 'es2022'
  minify?: boolean;           // default: false
  sourcemap?: boolean;        // default: false
  strictBundling?: boolean;   // default: false
  fetchDependencies?: boolean; // default: false (install npm packages)
}

interface CreateWorkerResult {
  mainModule: string;
  modules: Modules;
  warnings?: string[];
}
```

## Testing

Tests are in `packages/tests/src/` using Vitest with `@cloudflare/vitest-pool-workers`.

**Test files:**
- `bundler.test.ts` - Unit tests for transform, parse, resolve functions
- `integration.test.ts` - GitHub import + npm install tests
- `e2e.test.ts` - End-to-end tests (requires playground running)

**Current test status:** 36 passing, 10 skipped

**Skipped tests:**
- `parseImportsAsync` - es-module-lexer requires WASM compilation (not available in workerd tests)
- `bundleWithEsbuild` integration - esbuild-wasm can't initialize in workerd tests
- E2E tests - Require playground to be running

**Test coverage:**
- `transformCode` - TypeScript/JSX transformation
- `parseImports` - Import parsing
- `resolveModule` - Module resolution
- `createWorker` - Full pipeline (multi-file, imports, paths)
- `parsePackageSpecifier` - Package specifier parsing
- `installDependencies` - npm package installation
- GitHub import - Fetching files from GitHub repos

## CI/CD

### CI Pipeline (`.github/workflows/ci.yml`)

Runs on push to main and PRs:

1. **changeset-check** - Warns if no changeset in PR
2. **lint** - Runs `biome check`
3. **typecheck** - Runs `tsc --noEmit`
4. **test** - Runs vitest tests

### Release Pipeline (`.github/workflows/release.yml`)

On push to main:

1. Builds and tests
2. Creates "Version Packages" PR if changesets exist
3. When PR is merged, publishes to npm using OIDC

**OIDC Publishing:** Uses npm's trusted publishing feature - no `NPM_TOKEN` needed. Configure at npmjs.com under package settings -> Publishing access -> GitHub Actions.

## TypeScript Configuration

**Important:** We don't use `@cloudflare/workers-types` as a dependency. Instead:

1. `tsconfig.base.json` only includes `"types": ["node"]`
2. Packages with `wrangler.toml`/`wrangler.jsonc` run `wrangler types` to generate `worker-configuration.d.ts`
3. Generated type files are in `.gitignore`

Run `pnpm run generate-types` to regenerate types.

## Interactive Playground (`examples/basic/`)

A web-based playground for testing the library:

**Features:**
- Code editor with file tabs
- 5 pre-built examples (simple, multi-file, json-config, with-env, api-router)
- **GitHub Import** - Import from any GitHub repository URL
- Run button that installs deps, bundles, and executes via Worker Loader
- Output panel showing response, bundle info, warnings

**GitHub Import:**
- Click "Import from GitHub" button
- Paste any GitHub URL (repo, branch, or subdirectory)
- Example: `https://github.com/honojs/starter/tree/main/templates/cloudflare-workers`
- All files are fetched (except lock files)
- npm dependencies are automatically installed from registry

**API Endpoints:**
- `POST /api/github` - Import files from any GitHub URL
- `POST /api/run` - Install deps, bundle, and execute worker code

**How `/api/run` works:**
```typescript
// 1. Install npm dependencies
const { files: filesWithDeps } = await installDependencies(files);

// 2. Bundle with transform-only mode (esbuild fallback)
const { mainModule, modules } = await createWorker({
  files: filesWithDeps,
  bundle: true,
  fetchDependencies: true,  // Already installed, but enables the flow
});

// 3. Create dynamic worker via Worker Loader
const worker = env.LOADER.get(`worker-v${version}`, async () => ({
  mainModule,
  modules,
  compatibilityDate: '2025-01-01',
  env: {},
  globalOutbound: null,
}));

// 4. Execute and return response
const response = await worker.getEntrypoint().fetch(request);
```

**Wrangler config:**
```jsonc
{
  "assets": { "directory": "./public", "binding": "ASSETS" },
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

## Known Limitations

1. **esbuild-wasm in Workers** - WASM initialization can fail in wrangler dev; library falls back to transform-only mode gracefully
2. **es-module-lexer WASM** - Doesn't work in workerd test environment; regex fallback is used
3. **No Node.js built-ins** - Worker runtime doesn't have Node.js APIs (fs, path, etc.)
4. **npm registry latency** - `fetchDependencies` adds network latency for first fetch
5. **Large packages** - Very large npm packages may hit memory limits

## Common Tasks

### Adding a New Feature

1. Modify source in `packages/dynamic-worker-bundler/src/`
2. Export from `index.ts` if public
3. Add tests in `packages/tests/src/`
4. Run `pnpm test` to verify
5. Create changeset: `pnpm changeset`

### Fixing a Bug

1. Write failing test first
2. Fix the code
3. Run `pnpm test`
4. Create changeset with `patch` bump

### Releasing a New Version

1. Create changesets for each change: `pnpm changeset`
2. Push to main
3. CI creates "Version Packages" PR
4. Review and merge the PR
5. CI automatically publishes to npm

### Adding a New Example

Add files to `examples/basic/public/app.js` in the `EXAMPLES` object:

```javascript
const EXAMPLES = {
  'my-example': {
    'src/index.ts': `export default { fetch: () => new Response('...') }`,
    'package.json': JSON.stringify({ main: 'src/index.ts' }),
  },
};
```

## API Reference

### `createWorker(options): Promise<CreateWorkerResult>`

Main function. Takes source files, installs dependencies (optional), transforms, and bundles.

### `installDependencies(files, options?): Promise<InstallResult>`

Install npm packages into virtual node_modules. Called automatically when `fetchDependencies: true`.

### `transformCode(code, options): TransformResult`

Transform TypeScript/JSX to JavaScript using Sucrase.

### `parseImports(code): string[]`

Parse import specifiers from code (sync, regex-based).

### `parseImportsAsync(code): Promise<string[]>`

Parse imports using es-module-lexer (async, faster).

### `resolveModule(specifier, options): ResolveResult`

Resolve import specifier to file path in virtual file system.

### `fetchFromCDN(specifier, cdnUrl?): Promise<FetchResult>`

Legacy: Fetch npm package from esm.sh CDN.

### `parsePackageSpecifier(specifier): { name, version?, subpath? }`

Parse package specifier into components.

## Debugging Tips

1. **Bundling fails silently** - Set `strictBundling: true` to get error details
2. **Import not found** - Check `warnings` array in result
3. **npm install fails** - Check console for "Installing..." and "Failed to install" messages
4. **Type errors** - Run `pnpm run generate-types` then `pnpm run typecheck`
5. **Test failures** - Run `pnpm test` (builds automatically)

## Environment Requirements

- Node.js >= 22
- pnpm (version 10 recommended)
- For playground: Cloudflare account with Worker Loader access (closed beta)

## Architecture Decisions

### Why npm registry instead of esm.sh?

Initially, we tried using esm.sh CDN for fetching dependencies. However, this approach had problems:

1. esm.sh returns code with relative imports to other esm.sh URLs
2. Transitive dependencies need to be fetched and bundled
3. This only works with esbuild bundling (which requires WASM)
4. WASM can't initialize reliably in all environments

**Solution:** Fetch packages directly from npm registry, similar to `npm install`:
- Get the actual npm package structure with proper `exports`/`main` fields
- Transitive dependencies resolved via each package's `package.json`
- Works in transform-only mode (no WASM required)
- No weird URL imports to handle

### Why transform-only mode as fallback?

esbuild-wasm requires WASM compilation, which can fail in:
- wrangler dev local environment
- Some restricted Worker environments
- Test runners (vitest-pool-workers)

Transform-only mode uses Sucrase (pure JavaScript) and works everywhere. It produces multiple modules instead of a single bundle, but Worker Loader handles this fine.

### Why virtual file system?

The library operates on a `Files` object (`Record<string, string>`) instead of real files because:
- Worker Loader expects modules as strings
- Users may provide code from various sources (GitHub, databases, user input)
- Enables running in Workers without file system access
- Simplifies testing
