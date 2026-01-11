# workers-builder

## 0.1.0

### Minor Changes

- [`3080a87`](https://github.com/danlapid/workers-builder/commit/3080a875de0cb7bae07ae53ee1d5b14416e5c691) Thanks [@danlapid](https://github.com/danlapid)! - Initial release

- [`9e8839d`](https://github.com/danlapid/workers-builder/commit/9e8839dac1371237d29970a9eeae3a28f5f691e5) Thanks [@danlapid](https://github.com/danlapid)! - Initial release of workers-builder

  Features:

  - `createWorker()` function to bundle source files for Worker Loader binding
  - TypeScript and JSX transformation via Sucrase
  - Module resolution with package.json exports field support
  - Import rewriting to match Worker Loader's expected module paths
  - Optional esbuild-wasm bundling with graceful fallback to transform-only mode
  - `installDependencies()` function to install npm packages from registry into virtual node_modules
  - `fetchDependencies` option to automatically install dependencies before bundling
  - Configurable options: `bundle`, `strictBundling`, `fetchDependencies`, `externals`, `minify`, `sourcemap`
