---
"dynamic-worker-bundler": minor
---

Initial release of dynamic-worker-bundler

Features:
- `createWorker()` function to bundle source files for Worker Loader binding
- TypeScript and JSX transformation via Sucrase
- Module resolution with package.json exports field support
- Import rewriting to match Worker Loader's expected module paths
- Optional esbuild-wasm bundling with graceful fallback to transform-only mode
- `installDependencies()` function to install npm packages from registry into virtual node_modules
- `fetchDependencies` option to automatically install dependencies before bundling
- Configurable options: `bundle`, `strictBundling`, `fetchDependencies`, `externals`, `minify`, `sourcemap`
