# Implementation Plan: Dynamic Worker Bundler Improvements

## Overview

This plan covers 8 tasks to improve the dynamic-worker-bundler project:
1. Fix Biome lint warnings
2. Add changesets for versioning
3. Add CI/CD GitHub Actions
4. Add OIDC publish script
5. Add npm dependency fetching via esm.sh
6. Improve esbuild-wasm error handling
7. Add es-module-lexer for faster parsing
8. Final testing

---

## Task 1: Fix Biome Lint Warnings

### File: `biome.json`
**Change:** Update schema version from `2.3.10` to `2.3.11`

```diff
- "$schema": "https://biomejs.dev/schemas/2.3.10/schema.json"
+ "$schema": "https://biomejs.dev/schemas/2.3.11/schema.json"
```

### File: `packages/dynamic-worker-bundler/src/bundler.ts` (line 300)
**Change:** Use dot notation instead of bracket notation for object properties

```diff
- const entry = exp['import'] ?? exp['default'] ?? exp['module'];
+ const entry = exp.import ?? exp.default ?? exp.module;
```

---

## Task 2: Add Changesets Setup

### New File: `.changeset/config.json`
```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "danlapid/dynamic-worker-bundler" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["dynamic-worker-bundler-tests", "basic-example"]
}
```

### New File: `.changeset/README.md`
```markdown
# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs.

## Adding a changeset

When you make a change that should be released, run:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages are affected
2. Choose the semver bump type (patch/minor/major)
3. Write a summary of the change

The changeset file will be committed with your PR.

## How releases work

When PRs with changesets are merged to `main`:
1. A "Version Packages" PR is automatically created/updated
2. This PR bumps versions and updates CHANGELOGs
3. When that PR is merged, packages are automatically published to npm

## Packages managed by changesets

- `dynamic-worker-bundler` - Core bundler library

## Ignored packages (not published)

- `dynamic-worker-bundler-tests` - Internal tests
- `basic-example` - Example project
```

### Modify: `package.json` (root)
Add devDependencies:
```json
"@changesets/changelog-github": "^0.5.2",
"@changesets/cli": "^2.29.8"
```

Add scripts:
```json
"changeset": "changeset",
"version-packages": "changeset version",
"release": "pnpm build && pnpm test && changeset publish",
"ci:publish": "pnpm build && node scripts/publish.mjs"
```

---

## Task 3: Add CI/CD GitHub Actions

### New File: `.github/workflows/ci.yml`
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  changeset-check:
    name: Changeset Check
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Check for changesets
        run: |
          # Check if there are any changeset files (excluding README.md and config.json)
          CHANGESETS=$(find .changeset -name "*.md" ! -name "README.md" 2>/dev/null | wc -l)
          if [ "$CHANGESETS" -eq 0 ]; then
            echo "::warning::No changeset found. If this PR includes changes that should be released, run 'pnpm changeset' to create one."
            echo ""
            echo "To add a changeset:"
            echo "  1. Run: pnpm changeset"
            echo "  2. Select the affected packages"
            echo "  3. Choose the version bump type (patch/minor/major)"
            echo "  4. Write a summary of the changes"
            echo "  5. Commit the generated file"
            echo ""
            echo "Skip this if your changes are:"
            echo "  - Documentation only"
            echo "  - Test only"
            echo "  - CI/tooling changes"
          else
            echo "✓ Found $CHANGESETS changeset(s)"
          fi

  lint:
    name: Lint & Format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Biome check
        run: pnpm check

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm build

      - name: Type check
        run: pnpm typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test
```

### New File: `.github/workflows/release.yml`
```yaml
name: Release

on:
  push:
    branches:
      - main

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Upgrade npm for OIDC support
        run: npm install -g npm@latest && npm --version

      - name: Build packages
        run: pnpm build

      - name: Run tests
        run: pnpm test

      - name: Create Release Pull Request or Publish
        id: changesets
        uses: changesets/action@v1
        with:
          version: pnpm version-packages
          publish: pnpm ci:publish
          title: 'chore: version packages'
          commit: 'chore: version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Uses OIDC trusted publishing - no NPM_TOKEN needed
          # Configure trusted publishers at npmjs.com for each package
```

---

## Task 4: Add Publish Script

### New File: `scripts/publish.mjs`
```javascript
#!/usr/bin/env node

/**
 * Publish script that uses npm directly for OIDC trusted publishing support.
 * pnpm doesn't support OIDC, so we use npm publish which automatically
 * handles OIDC authentication when running in GitHub Actions.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PACKAGES = ['packages/dynamic-worker-bundler'];

function getPackageInfo(dir) {
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  return { name: pkg.name, version: pkg.version };
}

function isPublished(name, version) {
  try {
    execSync(`npm view ${name}@${version} version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function publish(dir) {
  const { name, version } = getPackageInfo(dir);

  if (isPublished(name, version)) {
    console.log(`⏭️  ${name}@${version} already published, skipping`);
    return;
  }

  console.log(`📦 Publishing ${name}@${version}...`);
  try {
    execSync('npm publish --access public --provenance', {
      cwd: dir,
      stdio: 'inherit',
    });
    console.log(`✅ Published ${name}@${version}`);
  } catch {
    console.error(`❌ Failed to publish ${name}@${version}`);
    process.exit(1);
  }
}

console.log('🚀 Publishing packages with npm (OIDC enabled)\n');

for (const pkg of PACKAGES) {
  publish(pkg);
}

console.log('\n✨ Done!');
```

---

## Task 5: Add npm Dependency Fetching via esm.sh

### Modify: `packages/dynamic-worker-bundler/src/types.ts`
Add new options to `CreateWorkerOptions`:

```typescript
/**
 * Fetch missing npm dependencies from esm.sh CDN.
 * When enabled, bare import specifiers that aren't in `files` or `externals`
 * will be fetched from esm.sh with all transitive dependencies bundled.
 * @default false
 */
fetchDependencies?: boolean;

/**
 * Custom CDN URL for fetching dependencies.
 * The CDN must support esm.sh-compatible URL patterns.
 * @default 'https://esm.sh'
 */
cdnUrl?: string;
```

### New File: `packages/dynamic-worker-bundler/src/fetcher.ts`
```typescript
/**
 * Fetches npm packages from esm.sh CDN.
 * esm.sh automatically bundles all transitive dependencies.
 */

export interface FetchResult {
  /** The bundled code from the CDN */
  code: string;
  /** The final URL after redirects */
  finalUrl: string;
}

/**
 * Fetch an npm package from esm.sh CDN.
 * The CDN automatically bundles all transitive dependencies.
 * 
 * @param specifier - Package specifier (e.g., 'lodash', 'lodash@4.17.21', 'lodash/debounce')
 * @param cdnUrl - CDN base URL (default: 'https://esm.sh')
 * @returns The bundled code and final URL
 */
export async function fetchFromCDN(
  specifier: string,
  cdnUrl = 'https://esm.sh'
): Promise<FetchResult> {
  const url = `${cdnUrl}/${specifier}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(
      `Failed to fetch '${specifier}' from CDN: ${response.status} ${response.statusText}`
    );
  }
  
  const code = await response.text();
  
  return {
    code,
    finalUrl: response.url,
  };
}

/**
 * Resolve esm.sh relative imports to absolute URLs.
 * esm.sh returns code with relative imports like "/lodash@4.17.21/es2022/lodash.mjs"
 * which need to be resolved to full URLs.
 * 
 * @param code - The code from esm.sh
 * @param baseUrl - The base URL of the CDN
 * @returns Code with resolved import URLs
 */
export function resolveEsmShImports(code: string, cdnUrl = 'https://esm.sh'): string {
  // Match imports that start with / (esm.sh relative paths)
  // e.g., import "/lodash@4.17.21/es2022/lodash.mjs"
  return code.replace(
    /(import\s+(?:[\w*{}\s,]+\s+from\s+)?|export\s+(?:[\w*{}\s,]+\s+)?from\s+)(['"])(\/.+?)\2/g,
    (match, prefix, quote, path) => {
      return `${prefix}${quote}${cdnUrl}${path}${quote}`;
    }
  );
}
```

### Modify: `packages/dynamic-worker-bundler/src/bundler.ts`
Add support for `fetchDependencies` option in the bundler.

Key changes:
1. Accept `fetchDependencies` and `cdnUrl` options
2. In `transformAndResolve()`, when a bare import is encountered and not in files/externals:
   - If `fetchDependencies` is true, fetch from CDN
   - Add fetched code to modules
   - Rewrite the import to point to the fetched module

### Modify: `packages/dynamic-worker-bundler/src/resolver.ts`
Make `resolveModule` support async fetching when needed.

### New File: `packages/tests/src/fetcher.test.ts`
```typescript
import { describe, expect, it } from 'vitest';
import { fetchFromCDN, resolveEsmShImports } from 'dynamic-worker-bundler';

describe('fetchFromCDN', () => {
  it('should fetch lodash from esm.sh', async () => {
    const result = await fetchFromCDN('lodash');
    expect(result.code).toContain('esm.sh');
    expect(result.finalUrl).toContain('esm.sh');
  });

  it('should fetch a specific version', async () => {
    const result = await fetchFromCDN('lodash@4.17.21');
    expect(result.code).toContain('lodash');
  });

  it('should throw for non-existent packages', async () => {
    await expect(fetchFromCDN('this-package-does-not-exist-12345'))
      .rejects.toThrow('Failed to fetch');
  });
});

describe('resolveEsmShImports', () => {
  it('should resolve relative esm.sh imports to absolute URLs', () => {
    const code = `import "/lodash@4.17.21/es2022/lodash.mjs";`;
    const resolved = resolveEsmShImports(code);
    expect(resolved).toBe(`import "https://esm.sh/lodash@4.17.21/es2022/lodash.mjs";`);
  });
});
```

---

## Task 6: Improve esbuild-wasm Error Handling

### Modify: `packages/dynamic-worker-bundler/src/types.ts`
Add new option:

```typescript
/**
 * If true, throw an error when bundling fails instead of falling back to transform-only mode.
 * Useful for CI/CD pipelines where you want to catch bundling issues early.
 * @default false
 */
strictBundling?: boolean;
```

### Modify: `packages/dynamic-worker-bundler/src/bundler.ts`
Update error handling in `createWorker()`:

```typescript
if (bundle) {
  try {
    return await bundleWithEsbuild(files, entryPoint, externals, minify, sourcemap);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    if (strictBundling) {
      throw new Error(
        `Bundling failed: ${message}\n\n` +
        `Hints:\n` +
        `  - Set bundle: false to use transform-only mode\n` +
        `  - Ensure esbuild-wasm is properly initialized\n` +
        `  - Check that all imports can be resolved`
      );
    }
    
    console.warn(
      `[dynamic-worker-bundler] esbuild bundling failed, falling back to transform-only mode.\n` +
      `Reason: ${message}\n` +
      `Tip: This typically happens when esbuild-wasm cannot initialize in the current environment.\n` +
      `     Use strictBundling: true to fail fast instead of falling back.`
    );
  }
}
```

Also improve `initializeEsbuild()`:

```typescript
async function initializeEsbuild(esbuild: typeof import('esbuild-wasm')): Promise<void> {
  if (esbuildInitialized) return;

  try {
    await esbuild.initialize({
      worker: false,
    });
    esbuildInitialized = true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot call "initialize" more than once')) {
      esbuildInitialized = true;
      return;
    }
    
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to initialize esbuild-wasm: ${message}\n\n` +
      `This may happen if:\n` +
      `  - Running in an environment that doesn't support WASM\n` +
      `  - The esbuild WASM binary couldn't be loaded\n` +
      `  - There's a CSP policy blocking WASM execution\n\n` +
      `Consider using bundle: false for transform-only mode.`
    );
  }
}
```

---

## Task 7: Add es-module-lexer for Faster Import Parsing

### Modify: `packages/dynamic-worker-bundler/package.json`
Add dependency:
```json
"es-module-lexer": "^2.0.0"
```

### Modify: `packages/dynamic-worker-bundler/src/resolver.ts`
Replace the regex-based `parseImports()` with es-module-lexer:

```typescript
import { init, parse } from 'es-module-lexer';

let lexerInitialized = false;

/**
 * Parse imports from a JavaScript/TypeScript source file.
 * Uses es-module-lexer for fast, accurate parsing.
 */
export async function parseImportsAsync(code: string): Promise<string[]> {
  if (!lexerInitialized) {
    await init;
    lexerInitialized = true;
  }
  
  const [imports] = parse(code);
  
  return imports
    .filter(imp => imp.n !== undefined) // Only include imports with specifiers
    .map(imp => imp.n as string);
}

// Keep the sync version for backwards compatibility
export function parseImports(code: string): string[] {
  // ... existing regex implementation ...
}
```

### Modify: `packages/dynamic-worker-bundler/src/bundler.ts`
Update to use `parseImportsAsync` where possible for better performance.

### Update: `packages/dynamic-worker-bundler/src/index.ts`
Export the new async function:
```typescript
export { parseImports, parseImportsAsync } from './resolver.js';
```

---

## Task 8: Final Testing

After all changes are made:

1. Run `pnpm install` to install new dependencies
2. Run `pnpm run build` to verify TypeScript compilation
3. Run `pnpm run check` to verify Biome passes
4. Run `pnpm run test` to verify all tests pass
5. Manually test the example: `pnpm run example`

---

## Execution Order

1. Task 1 - Fix Biome lint warnings
2. Task 2 - Add changesets setup
3. Task 4 - Add publish script
4. Task 3 - Add CI/CD workflows
5. Task 7 - Add es-module-lexer
6. Task 6 - Improve esbuild error handling
7. Task 5 - Add npm dependency fetching
8. Task 8 - Final testing

---

## Dependencies to Add

Root `package.json`:
- `@changesets/changelog-github`: `^0.5.2`
- `@changesets/cli`: `^2.29.8`

`packages/dynamic-worker-bundler/package.json`:
- `es-module-lexer`: `^2.0.0`
