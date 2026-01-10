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
│   │   │   ├── transformer.ts      # TypeScript/JSX transformation (Sucrase)
│   │   │   ├── resolver.ts         # Module resolution & import parsing
│   │   │   ├── fetcher.ts          # CDN fetching from esm.sh
│   │   │   └── types.ts            # TypeScript interfaces
│   │   ├── dist/                   # Built output (gitignored)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   └── tests/                      # Test package
│       ├── src/
│       │   ├── index.ts            # Empty worker entry (required by vitest)
│       │   └── bundler.test.ts     # All tests
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
│       │   └── index.ts            # Worker: serves assets + /api/run
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
  modules: {                             // All modules
    'src/index.js': 'export default {...}',
    'src/utils.js': 'export function...',
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
2. **Transforms TypeScript/JSX** to JavaScript using Sucrase
3. **Resolves and rewrites imports** to match Worker Loader's expected paths
4. **Optionally bundles** everything with esbuild-wasm
5. **Optionally fetches npm dependencies** from esm.sh CDN

```typescript
import { createWorker } from 'dynamic-worker-bundler';

const { mainModule, modules, warnings } = await createWorker({
  files: {
    'src/index.ts': `
      import { greet } from './utils';
      export default { fetch: () => new Response(greet('World')) }
    `,
    'src/utils.ts': `export function greet(name: string) { return 'Hello ' + name; }`,
    'package.json': JSON.stringify({ main: 'src/index.ts' }),
  },
  bundle: false,           // true = use esbuild-wasm to bundle
  strictBundling: false,   // true = throw on bundle failure
  fetchDependencies: false, // true = fetch npm packages from CDN
  cdnUrl: 'https://esm.sh',
});
```

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
- If `bundle: true` but esbuild fails, it falls back to transform mode (with warning)
- Use `strictBundling: true` to throw instead of falling back

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
- package.json exports field (via `resolve.exports`)
- Extension resolution (`.ts`, `.tsx`, `.js`, etc.)
- Index file resolution (`./utils` -> `./utils/index.ts`)

**Key functions:**
- `resolveModule(specifier, options)` - Main resolution function
- `parseImports(code)` - Regex-based import parsing (sync)
- `parseImportsAsync(code)` - es-module-lexer parsing (async, faster)

### `fetcher.ts` - CDN Fetching

Fetches npm packages from esm.sh CDN when `fetchDependencies: true`:

```typescript
const { code, finalUrl } = await fetchFromCDN('lodash', 'https://esm.sh');
```

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
  fetchDependencies?: boolean; // default: false
  cdnUrl?: string;            // default: 'https://esm.sh'
}

interface CreateWorkerResult {
  mainModule: string;
  modules: Modules;
  warnings?: string[];
}
```

## Testing

Tests are in `packages/tests/src/bundler.test.ts` using Vitest with `@cloudflare/vitest-pool-workers`.

**Current test status:** 28 passing, 3 skipped

**Skipped tests:** `parseImportsAsync` tests are skipped because es-module-lexer requires WASM compilation, which is not available in the workerd test environment. The function works correctly in production.

**Test coverage:**
- `transformCode` - TypeScript/JSX transformation
- `parseImports` - Import parsing
- `resolveModule` - Module resolution
- `createWorker` - Full pipeline (multi-file, imports, paths)
- `parsePackageSpecifier` - Package specifier parsing
- `resolveEsmShImports` - CDN import resolution

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
- Monaco-style code editor (simple textarea)
- File tabs (add/remove files)
- 5 pre-built examples
- **GitHub Templates integration** - Load templates directly from `cloudflare/templates` repository
- Run button that bundles and executes via `/api/run`
- Output panel showing response, bundle info, warnings

**GitHub Templates Integration:**
- Click "GitHub" button to browse available templates
- Templates are fetched from https://github.com/cloudflare/templates
- Search and filter templates by name
- ALL files from the template are downloaded (except lock files)
- npm dependencies are automatically fetched from esm.sh CDN
- esbuild bundles everything into a single file with tree-shaking

**API Endpoints:**
- `GET /api/templates` - List all available templates from cloudflare/templates
- `GET /api/templates/:name` - Fetch ALL files from a specific template
- `POST /api/run` - Bundle (with `bundle: true`, `fetchDependencies: true`) and execute worker code

**Architecture:**
- Uses Workers Static Assets to serve HTML/CSS/JS from `public/`
- Worker handles API endpoints and creates dynamic workers using Worker Loader binding
- Templates are fetched via GitHub API with 5-minute caching
- `createWorker()` uses esbuild-wasm to bundle all code + dependencies into a single `bundle.js`

**Wrangler config:**
```jsonc
{
  "assets": { "directory": "./public", "binding": "ASSETS" },
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

## Known Limitations

1. **esbuild-wasm in Workers** - WASM initialization can fail in some environments; library falls back gracefully
2. **es-module-lexer WASM** - Doesn't work in workerd test environment; regex fallback is used
3. **No Node.js built-ins** - Worker runtime doesn't have Node.js APIs
4. **CDN latency** - `fetchDependencies` adds network latency for first fetch

## Common Tasks

### Adding a New Feature

1. Modify source in `packages/dynamic-worker-bundler/src/`
2. Export from `index.ts` if public
3. Add tests in `packages/tests/src/bundler.test.ts`
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

Main function. See `types.ts` for full options.

### `transformCode(code, options): TransformResult`

Transform TypeScript/JSX to JavaScript.

### `parseImports(code): string[]`

Parse import specifiers from code (sync, regex-based).

### `parseImportsAsync(code): Promise<string[]>`

Parse imports using es-module-lexer (async, faster).

### `resolveModule(specifier, options): ResolveResult`

Resolve import specifier to file path.

### `fetchFromCDN(specifier, cdnUrl?): Promise<FetchResult>`

Fetch npm package from esm.sh CDN.

### `parsePackageSpecifier(specifier): { name, version?, subpath? }`

Parse package specifier into components.

### `resolveEsmShImports(code, cdnUrl?): string`

Resolve esm.sh relative imports to absolute URLs.

## Debugging Tips

1. **Bundling fails silently** - Set `strictBundling: true` to get error details
2. **Import not found** - Check `warnings` array in result
3. **Type errors** - Run `pnpm run generate-types` then `pnpm run typecheck`
4. **Test failures** - Run `pnpm test` (builds automatically)

## Environment Requirements

- Node.js >= 22
- pnpm (version 10 recommended)
- For playground: Cloudflare account with Worker Loader access (closed beta)
