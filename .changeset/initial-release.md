---
"dynamic-worker-bundler": minor
---

Initial release of dynamic-worker-bundler

Features:
- `createWorker()` function to bundle source files for Worker Loader binding
- TypeScript and JSX transformation via Sucrase
- Module resolution with package.json exports field support
- Import rewriting to match Worker Loader's expected module paths
- Optional esbuild-wasm bundling with graceful fallback
- NPM dependency fetching from esm.sh CDN
- Configurable options: `bundle`, `strictBundling`, `fetchDependencies`, `externals`, `minify`, `sourcemap`
