# Dynamic Worker Bundler - Exploration Notes

## Problem Statement

The Cloudflare Worker Loader binding provides a low-level API to dynamically spawn Workers with arbitrary code. The API requires:
- `mainModule`: The entry point path
- `modules`: A dictionary of module paths to their contents

The goal is to create a helper that takes a source directory (as a `files` object) and produces the appropriate `mainModule` and `modules` output.

## Key Constraints

1. **Must run entirely within a Worker** - No Node.js, no spawning processes
2. **Limited memory** - Workers have 128MB memory limit
3. **No filesystem access** - All files are in-memory as strings
4. **Must handle TypeScript** - Need to transpile TS to JS
5. **Package resolution** - Need to resolve `import` statements

## Research Findings

### Bundling/Transformation Options

#### 1. esbuild-wasm
- **Pros**: Full bundler, tree-shaking, minification, fast
- **Cons**: 
  - Requires WASM initialization with a binary (~10MB)
  - Loading the WASM in Workers is complex (need to bundle or fetch)
  - Uses Web Workers internally which may not work in CF Workers
- **Status**: Worth trying but complex setup

#### 2. Sucrase
- **Pros**: 
  - Pure JavaScript, no WASM
  - ~20x faster than Babel
  - Small bundle size
  - Specifically designed for TypeScript/JSX stripping
- **Cons**: 
  - Only transforms, doesn't bundle
  - Doesn't do tree shaking
  - Doesn't resolve imports
- **Status**: Great for TypeScript transformation, but needs custom bundling logic

#### 3. oxc-transform
- **Pros**: Fast, supports WASM via @aspect-build/oxc-wasm
- **Cons**: WASM dependency, similar complexity to esbuild-wasm
- **Status**: Alternative to esbuild-wasm

### Module Resolution Options

#### 1. resolve.exports
- **Pros**: 
  - Pure JavaScript, zero dependencies
  - ~950 bytes
  - Handles package.json `exports` and `imports` fields correctly
- **Cons**: Only resolves the package.json exports, doesn't do full path resolution
- **Status**: Essential for handling modern package.json exports

#### 2. enhanced-resolve
- **Pros**: Full webpack-style resolution
- **Cons**: Requires filesystem, designed for Node.js
- **Status**: Not suitable for Workers

#### 3. browser-resolve
- **Pros**: Browser field support
- **Cons**: Still requires filesystem
- **Status**: Not suitable for Workers

### Reference Implementation: esm.sh

esm.sh does bundling on the edge (Cloudflare Workers) with:
- esbuild as the bundler
- Custom caching and resolution
- Builds are queued and cached at the edge

Key insight: They likely run esbuild in a more powerful environment (not within the request handler), or use heavy caching.

## Proposed Architecture

Given the constraints, I propose a **tiered approach**:

### Tier 1: Simple Transform (No Bundling)
- Use **Sucrase** for TypeScript/JSX transformation
- Use **resolve.exports** for package.json resolution
- Custom simple module resolver for relative imports
- Output multiple modules (not bundled)

**Best for**: Simple Workers with minimal dependencies

### Tier 2: Full Bundling (esbuild-wasm)
- Initialize esbuild-wasm with WASM binary
- Custom virtual filesystem plugin
- Full bundling and tree-shaking

**Best for**: Complex Workers with npm dependencies

### Implementation Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    createWorker(options)                     │
├─────────────────────────────────────────────────────────────┤
│  1. Detect entry point from package.json or defaults        │
│  2. Parse all files to find imports                         │
│  3. Resolve imports (relative, npm packages)                │
│  4. Transform TypeScript files using Sucrase                │
│  5. If bundling: use esbuild-wasm to bundle                 │
│  6. Return { mainModule, modules }                          │
└─────────────────────────────────────────────────────────────┘
```

## Key Components Needed

1. **Entry Point Detection** ✅
   - Read package.json
   - Check exports, module, main fields
   - Fall back to common defaults (src/index.ts, etc.)

2. **Import Parser** (TODO)
   - Parse ES module imports
   - Extract specifiers
   - Handle dynamic imports

3. **Module Resolver** (TODO)
   - Relative path resolution with extension detection
   - Package.json exports/imports resolution
   - node_modules traversal (if files include them)

4. **TypeScript Transformer** (TODO)
   - Use Sucrase or esbuild-wasm
   - Handle .ts, .tsx, .mts files
   - Preserve ES modules syntax

5. **Optional Bundler** (TODO)
   - esbuild-wasm for full bundling
   - Tree shaking
   - Code splitting (if needed)

## Open Questions

1. **How to handle npm dependencies?**
   - Option A: Require all node_modules to be in `files`
   - Option B: Fetch from npm/esm.sh on demand
   - Option C: Mark as external (user must handle)

2. **WASM initialization in Workers?**
   - Need to test if esbuild-wasm works with Workers
   - May need to use fetch() to get WASM binary
   - Memory constraints may be an issue

3. **Caching strategy?**
   - Can use Durable Objects or KV for caching bundles
   - Cache key = hash of input files

## Next Steps

1. [x] Set up project structure
2. [x] Research available tools
3. [x] Implement Sucrase-based TypeScript transformation
4. [x] Implement custom module resolver
5. [x] Test with simple Workers (17 tests passing)
6. [x] Explore esbuild-wasm initialization in Workers
7. [x] Add bundling support (with fallback to transform-only)
8. [ ] Add npm dependency resolution (stretch goal)
9. [ ] Test with Worker Loader binding
10. [ ] Add source map support
11. [ ] Add caching layer
12. [ ] Performance optimization

## Current Implementation Status

### Working Features
- **TypeScript transformation** via Sucrase (pure JS, no WASM)
- **JSX transformation** with automatic/classic/preserve modes
- **Entry point detection** from package.json (exports, module, main)
- **Module resolution** for relative imports with extension detection
- **Package resolution** using resolve.exports for modern package.json
- **Import parsing** for dependency graph traversal
- **Import rewriting** to convert relative imports to full output paths
- **Multi-file support** with proper import path resolution across directories
- **JSON module support** via `{ json: object }` format
- **esbuild-wasm bundling** (with fallback to transform-only mode)

### Tested with Worker Loader Binding
All four test cases pass with the actual Worker Loader binding (wrangler 4.58.0):
1. **Simple single-file worker** - TypeScript transformed to JS
2. **Multi-file worker** - Imports across directories properly resolved
3. **Worker with JSON config** - JSON modules properly registered
4. **Worker with env bindings** - Environment variables passed through

### Known Limitations
1. **esbuild-wasm in Workers**: Requires WASM binary to be available. Wrangler handles bundling the WASM when deploying.
2. **npm dependencies**: Must be included in `files` or marked as external
3. **Source maps**: Implemented in transformer but not fully integrated

### Architecture

```
createWorker(options)
├── detectEntryPoint() - Find main module from package.json or defaults
├── bundle=true?
│   ├── bundleWithEsbuild() - Full bundling with tree-shaking
│   │   ├── initializeEsbuild() - Load WASM binary
│   │   └── virtualFsPlugin - Resolve from files object
│   └── (fallback) transformAndResolve()
└── bundle=false
    └── transformAndResolve() - Transform each file independently
        ├── parseImports() - Find dependencies
        ├── resolveModule() - Resolve import paths
        └── transformCode() - Convert TS/JSX to JS
```
