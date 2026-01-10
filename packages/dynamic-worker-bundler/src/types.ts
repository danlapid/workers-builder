/**
 * Input files for the bundler
 * Keys are file paths, values are file contents
 */
export type Files = Record<string, string>;

/**
 * Module format for Worker Loader binding
 */
export interface Module {
  js?: string;
  cjs?: string;
  text?: string;
  data?: ArrayBuffer;
  json?: object;
}

/**
 * Output modules for Worker Loader binding
 */
export type Modules = Record<string, string | Module>;

/**
 * Options for createWorker
 */
export interface CreateWorkerOptions {
  /**
   * Input files - keys are paths relative to project root, values are file contents
   */
  files: Files;

  /**
   * Entry point file path (relative to project root)
   * If not specified, will try to determine from package.json or use src/index.ts
   */
  entryPoint?: string;

  /**
   * Whether to bundle all dependencies into a single file
   * @default true
   */
  bundle?: boolean;

  /**
   * External modules that should not be bundled
   */
  externals?: string[];

  /**
   * Target environment
   * @default 'es2022'
   */
  target?: string;

  /**
   * Whether to minify the output
   * @default false
   */
  minify?: boolean;

  /**
   * Source map generation
   * @default false
   */
  sourcemap?: boolean;

  /**
   * If true, throw an error when bundling fails instead of falling back to transform-only mode.
   * Useful for CI/CD pipelines where you want to catch bundling issues early.
   * @default false
   */
  strictBundling?: boolean;

  /**
   * Fetch and install npm dependencies from the npm registry.
   * When enabled, dependencies listed in package.json will be downloaded
   * and added to a virtual node_modules directory before bundling.
   * @default false
   */
  fetchDependencies?: boolean;
}

/**
 * Result from createWorker
 */
export interface CreateWorkerResult {
  /**
   * The main module entry point path
   */
  mainModule: string;

  /**
   * All modules in the bundle
   */
  modules: Modules;

  /**
   * Any warnings generated during bundling
   */
  warnings?: string[];
}
