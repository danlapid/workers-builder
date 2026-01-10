import * as esbuild from 'esbuild-wasm';
// @ts-expect-error - WASM module import
import esbuildWasm from './esbuild.wasm';
import { installDependencies } from './installer.js';
import { parseImports, resolveModule } from './resolver.js';
import { getOutputPath, isJavaScriptFile, isTypeScriptFile, transformCode } from './transformer.js';
import type { CreateWorkerOptions, CreateWorkerResult, Files, Modules } from './types.js';

/**
 * Creates a worker bundle from source files.
 *
 * This function performs:
 * 1. Entry point detection (from package.json or defaults)
 * 2. Dependency installation (if fetchDependencies is true)
 * 3. TypeScript/JSX transformation (via Sucrase)
 * 4. Module resolution (handling imports/exports)
 * 5. Optional bundling (combining all modules into one)
 *
 * @param options - Configuration options
 * @returns The main module path and all modules
 */
export async function createWorker(options: CreateWorkerOptions): Promise<CreateWorkerResult> {
  let {
    files,
    bundle = true,
    externals = [],
    target = 'es2022',
    minify = false,
    sourcemap = false,
    strictBundling = false,
    fetchDependencies = false,
  } = options;

  // If fetchDependencies is enabled, install npm dependencies first
  const installWarnings: string[] = [];
  if (fetchDependencies) {
    const installResult = await installDependencies(files, {
      onProgress: (msg) => console.log(`[dynamic-worker-bundler] ${msg}`),
    });
    files = installResult.files;
    installWarnings.push(...installResult.warnings);

    if (installResult.installed.length > 0) {
      console.log(
        `[dynamic-worker-bundler] Installed ${installResult.installed.length} packages: ${installResult.installed.join(', ')}`
      );
    }
  }

  // Detect entry point
  const entryPoint = options.entryPoint ?? detectEntryPoint(files);

  if (!entryPoint) {
    throw new Error('Could not determine entry point. Please specify entryPoint option.');
  }

  if (!(entryPoint in files)) {
    throw new Error(`Entry point "${entryPoint}" not found in files.`);
  }

  if (bundle) {
    // Try bundling with esbuild-wasm
    try {
      const result = await bundleWithEsbuild(
        files,
        entryPoint,
        externals,
        target,
        minify,
        sourcemap
      );

      // Add install warnings to result
      if (installWarnings.length > 0) {
        result.warnings = [...(result.warnings ?? []), ...installWarnings];
      }

      return result;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : String(error);

      if (strictBundling) {
        throw new Error(
          `Bundling failed: ${stack}\n\n` +
            'Hints:\n' +
            '  - Set bundle: false to use transform-only mode\n' +
            '  - Ensure esbuild-wasm is properly initialized\n' +
            '  - Check that all imports can be resolved'
        );
      }

      // If esbuild fails, fall back to transform-only mode
      console.warn(
        '[dynamic-worker-bundler] esbuild bundling failed, falling back to transform-only mode.\n' +
          `Reason: ${stack}\n\n` +
          'This may happen if:\n' +
          '  - Running in an environment that does not support WASM\n' +
          '  - The esbuild WASM binary could not be loaded\n' +
          '  - There is a CSP policy blocking WASM execution\n\n' +
          'Consider using bundle: false for transform-only mode.\n' +
          'Tip: This typically happens when esbuild-wasm cannot initialize in the current environment.\n' +
          '     Use strictBundling: true to fail fast instead of falling back.'
      );
    }
  }

  // No bundling or bundling failed - transform files and resolve dependencies
  const result = await transformAndResolve(files, entryPoint, externals, sourcemap);

  // Add install warnings to result
  if (installWarnings.length > 0) {
    result.warnings = [...(result.warnings ?? []), ...installWarnings];
  }

  return result;
}

/**
 * Transform all files and resolve their dependencies.
 * This produces multiple modules instead of a single bundle.
 */
async function transformAndResolve(
  files: Files,
  entryPoint: string,
  externals: string[],
  sourcemap: boolean
): Promise<CreateWorkerResult> {
  const modules: Modules = {};
  const warnings: string[] = [];
  const processed = new Set<string>();
  const toProcess = [entryPoint];

  // Map from source path to output path
  const pathMap = new Map<string, string>();

  // First pass: collect all files and their output paths
  while (toProcess.length > 0) {
    const filePath = toProcess.pop();
    if (!filePath || processed.has(filePath)) continue;
    processed.add(filePath);

    const content = files[filePath];
    if (content === undefined) {
      warnings.push(`File not found: ${filePath}`);
      continue;
    }

    // Calculate output path
    const outputPath = isTypeScriptFile(filePath) ? getOutputPath(filePath) : filePath;
    pathMap.set(filePath, outputPath);

    // Handle non-JS files
    if (!isJavaScriptFile(filePath)) {
      if (filePath.endsWith('.json')) {
        try {
          modules[filePath] = { json: JSON.parse(content) };
        } catch {
          warnings.push(`Failed to parse JSON file: ${filePath}`);
        }
      } else {
        // Include as text
        modules[filePath] = { text: content };
      }
      continue;
    }

    // Parse imports and queue them for processing
    const imports = parseImports(content);
    for (const specifier of imports) {
      // Skip external modules
      if (externals.includes(specifier) || externals.some((e) => specifier.startsWith(`${e}/`))) {
        continue;
      }

      try {
        const resolved = resolveModule(specifier, {
          files,
          importer: filePath,
        });

        if (!resolved.external && !processed.has(resolved.path)) {
          toProcess.push(resolved.path);
        }
      } catch (error) {
        warnings.push(
          `Failed to resolve '${specifier}' from ${filePath}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  // Second pass: transform files and rewrite imports
  for (const [sourcePath, outputPath] of pathMap) {
    const content = files[sourcePath];
    if (content === undefined || !isJavaScriptFile(sourcePath)) continue;

    let transformedCode: string;

    if (isTypeScriptFile(sourcePath)) {
      try {
        const result = transformCode(content, {
          filePath: sourcePath,
          sourceMap: sourcemap,
        });
        transformedCode = result.code;
      } catch (error) {
        warnings.push(
          `Failed to transform ${sourcePath}: ${error instanceof Error ? error.message : error}`
        );
        continue;
      }
    } else {
      transformedCode = content;
    }

    // Rewrite imports to use the full output paths
    transformedCode = rewriteImports(transformedCode, sourcePath, files, pathMap, externals);

    // Add to output modules
    modules[outputPath] = transformedCode;
  }

  // Calculate the main module path (transformed entry point)
  const mainModule = isTypeScriptFile(entryPoint) ? getOutputPath(entryPoint) : entryPoint;

  if (warnings.length > 0) {
    return { mainModule, modules, warnings };
  }
  return { mainModule, modules };
}

/**
 * Rewrite import specifiers to use full output paths.
 * This is necessary because the Worker Loader expects imports to match registered module names.
 */
function rewriteImports(
  code: string,
  importer: string,
  files: Files,
  pathMap: Map<string, string>,
  externals: string[]
): string {
  // Match import/export statements with string specifiers
  // Handles: import x from 'y', import { x } from 'y', import 'y', export { x } from 'y', export * from 'y'
  const importExportRegex =
    /(import\s+(?:[\w*{}\s,]+\s+from\s+)?|export\s+(?:[\w*{}\s,]+\s+)?from\s+)(['"])([^'"]+)\2/g;

  // Get importer's output path to use as the base for resolving
  const importerOutputPath = pathMap.get(importer) ?? importer;

  return code.replace(
    importExportRegex,
    (match, prefix: string, quote: string, specifier: string) => {
      // Skip external modules
      if (externals.includes(specifier) || externals.some((e) => specifier.startsWith(`${e}/`))) {
        return match;
      }

      // Skip non-relative imports that aren't in our files (bare imports to npm packages)
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        // Try to resolve it - if it resolves to node_modules, rewrite the path
        try {
          const resolved = resolveModule(specifier, {
            files,
            importer,
          });

          if (resolved.external) {
            return match;
          }

          // Get the output path for the resolved module
          const resolvedOutputPath = pathMap.get(resolved.path) ?? resolved.path;

          // For node_modules imports, use the full path
          if (resolved.path.startsWith('node_modules/')) {
            return `${prefix}${quote}/${resolvedOutputPath}${quote}`;
          }

          // Calculate relative path for non-node_modules
          const relativePath = calculateRelativePath(importerOutputPath, resolvedOutputPath);
          return `${prefix}${quote}${relativePath}${quote}`;
        } catch {
          // Resolution failed, keep original
          return match;
        }
      }

      try {
        const resolved = resolveModule(specifier, {
          files,
          importer,
        });

        if (resolved.external) {
          return match;
        }

        // Get the output path for the resolved module
        const resolvedOutputPath = pathMap.get(resolved.path) ?? resolved.path;

        // Calculate the relative path from the importer's output location to the resolved output
        const relativePath = calculateRelativePath(importerOutputPath, resolvedOutputPath);

        // Return the rewritten import with the relative output path
        return `${prefix}${quote}${relativePath}${quote}`;
      } catch {
        // If resolution fails, keep the original
        return match;
      }
    }
  );
}

/**
 * Calculate relative path from one file to another.
 */
function calculateRelativePath(from: string, to: string): string {
  const fromDir = getDirectory(from);
  const toDir = getDirectory(to);
  const toFile = to.split('/').pop() ?? to;

  if (fromDir === toDir) {
    // Same directory
    return `./${toFile}`;
  }

  const fromParts = fromDir ? fromDir.split('/') : [];
  const toParts = toDir ? toDir.split('/') : [];

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Calculate relative path
  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  let relativePath = '';
  if (upCount === 0) {
    relativePath = './';
  } else {
    relativePath = '../'.repeat(upCount);
  }

  if (downParts.length > 0) {
    relativePath += `${downParts.join('/')}/`;
  }

  return relativePath + toFile;
}

function getDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return '';
  }
  return filePath.slice(0, lastSlash);
}

/**
 * Detect entry point from package.json or use defaults
 */
function detectEntryPoint(files: Files): string | undefined {
  // Try to read package.json
  const packageJsonContent = files['package.json'];
  if (packageJsonContent) {
    try {
      const pkg = JSON.parse(packageJsonContent) as {
        main?: string;
        module?: string;
        exports?: Record<string, unknown> | string;
      };

      // Check exports field first
      if (pkg.exports) {
        if (typeof pkg.exports === 'string') {
          return normalizeEntryPath(pkg.exports);
        }
        // Handle exports object - look for "." entry
        const dotExport = pkg.exports['.'];
        if (dotExport) {
          if (typeof dotExport === 'string') {
            return normalizeEntryPath(dotExport);
          }
          // Handle conditional exports
          if (typeof dotExport === 'object' && dotExport !== null) {
            const exp = dotExport as Record<string, unknown>;
            const entry = exp['import'] ?? exp['default'] ?? exp['module'];
            if (typeof entry === 'string') {
              return normalizeEntryPath(entry);
            }
          }
        }
      }

      // Check module field
      if (pkg.module) {
        return normalizeEntryPath(pkg.module);
      }

      // Check main field
      if (pkg.main) {
        return normalizeEntryPath(pkg.main);
      }
    } catch {
      // Invalid JSON, continue to defaults
    }
  }

  // Default entry points
  const defaultEntries = [
    'src/index.ts',
    'src/index.js',
    'src/index.mts',
    'src/index.mjs',
    'index.ts',
    'index.js',
    'src/worker.ts',
    'src/worker.js',
  ];

  for (const entry of defaultEntries) {
    if (entry in files) {
      return entry;
    }
  }

  return undefined;
}

function normalizeEntryPath(path: string): string {
  // Remove leading ./
  if (path.startsWith('./')) {
    return path.slice(2);
  }
  return path;
}

/**
 * Bundle files using esbuild-wasm
 */
async function bundleWithEsbuild(
  files: Files,
  entryPoint: string,
  externals: string[],
  target: string,
  minify: boolean,
  sourcemap: boolean
): Promise<CreateWorkerResult> {
  // Ensure esbuild is initialized (happens lazily on first use)
  await initializeEsbuild();

  const warnings: string[] = [];

  // Create a virtual file system plugin for esbuild
  const virtualFsPlugin: esbuild.Plugin = {
    name: 'virtual-fs',
    setup(build) {
      // Resolve all paths to our virtual file system
      build.onResolve({ filter: /.*/ }, async (args) => {
        // Handle entry point - it's passed directly without ./ prefix
        if (args.kind === 'entry-point') {
          const normalizedPath = args.path.startsWith('/') ? args.path.slice(1) : args.path;
          if (normalizedPath in files) {
            return { path: normalizedPath, namespace: 'virtual' };
          }
          // Entry point not found - this will cause a clear error
          return { path: args.path, namespace: 'virtual' };
        }

        // Handle relative imports
        if (args.path.startsWith('.')) {
          const resolved = resolveRelativePath(args.resolveDir, args.path, files);
          if (resolved) {
            return { path: resolved, namespace: 'virtual' };
          }
        }

        // Handle bare imports (npm packages)
        if (!args.path.startsWith('/') && !args.path.startsWith('.')) {
          // Check if it's in externals
          if (
            externals.includes(args.path) ||
            externals.some((e) => args.path.startsWith(`${e}/`))
          ) {
            return { path: args.path, external: true };
          }

          // Try to resolve from node_modules in virtual fs
          try {
            const result = resolveModule(args.path, { files });
            if (!result.external) {
              return { path: result.path, namespace: 'virtual' };
            }
          } catch {
            // Resolution failed
          }

          // Mark as external (package not found in node_modules)
          return { path: args.path, external: true };
        }

        // Absolute paths in virtual fs
        const normalizedPath = args.path.startsWith('/') ? args.path.slice(1) : args.path;
        if (normalizedPath in files) {
          return { path: normalizedPath, namespace: 'virtual' };
        }

        return { path: args.path, external: true };
      });

      // Load files from virtual file system
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
        const content = files[args.path];
        if (content === undefined) {
          return { errors: [{ text: `File not found: ${args.path}` }] };
        }

        const loader = getLoader(args.path);
        // Set resolveDir to the directory containing this file
        // This is critical for resolving relative imports within the file
        const lastSlash = args.path.lastIndexOf('/');
        const resolveDir = lastSlash >= 0 ? args.path.slice(0, lastSlash) : '';
        return { contents: content, loader, resolveDir };
      });
    },
  };

  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser', // Workers are browser-like
    target,
    minify,
    sourcemap: sourcemap ? 'inline' : false,
    plugins: [virtualFsPlugin],
    outfile: 'bundle.js',
  });

  const output = result.outputFiles?.[0];
  if (!output) {
    throw new Error('No output generated from esbuild');
  }

  const modules: Modules = {
    'bundle.js': output.text,
  };

  // Combine esbuild warnings with our warnings
  const allWarnings = [...warnings, ...result.warnings.map((w) => w.text)];

  if (allWarnings.length > 0) {
    return {
      mainModule: 'bundle.js',
      modules,
      warnings: allWarnings,
    };
  }
  return { mainModule: 'bundle.js', modules };
}

// Track esbuild initialization state
let esbuildInitialized = false;
let esbuildInitializePromise: Promise<void> | null = null;

/**
 * Initialize the esbuild bundler.
 * This is called automatically when needed - users don't need to call this directly.
 */
async function initializeEsbuild(): Promise<void> {
  // If already initialized, return immediately
  if (esbuildInitialized) return;

  // If initialization is in progress, wait for it
  if (esbuildInitializePromise) {
    return esbuildInitializePromise;
  }

  // Start initialization
  esbuildInitializePromise = (async () => {
    try {
      // Initialize esbuild with the pre-compiled WASM module
      // The WASM module is imported from './esbuild.wasm' which gets bundled with the library
      // Cloudflare compiles WASM imports at deploy time, giving us a WebAssembly.Module
      // We only need to instantiate it here, which is allowed at request time
      await esbuild.initialize({
        wasmModule: esbuildWasm,
        worker: false,
      });

      esbuildInitialized = true;
    } catch (error) {
      // If initialization fails, esbuild may already be initialized
      if (
        error instanceof Error &&
        error.message.includes('Cannot call "initialize" more than once')
      ) {
        esbuildInitialized = true;
        return;
      }
      throw error;
    }
  })();

  try {
    await esbuildInitializePromise;
  } catch (error) {
    // Reset promise so caller can try again
    esbuildInitializePromise = null;
    throw error;
  }
}

function resolveRelativePath(
  resolveDir: string,
  relativePath: string,
  files: Files
): string | undefined {
  // Normalize the resolve directory
  const dir = resolveDir.replace(/^\//, '');

  // Resolve the relative path
  const parts = dir ? dir.split('/') : [];
  const relParts = relativePath.split('/');

  for (const part of relParts) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.') {
      parts.push(part);
    }
  }

  const resolved = parts.join('/');

  // Try exact match
  if (resolved in files) {
    return resolved;
  }

  // Try adding extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
  for (const ext of extensions) {
    if (resolved + ext in files) {
      return resolved + ext;
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = `${resolved}/index${ext}`;
    if (indexPath in files) {
      return indexPath;
    }
  }

  return undefined;
}

function getLoader(path: string): esbuild.Loader {
  if (path.endsWith('.ts') || path.endsWith('.mts')) return 'ts';
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  return 'js';
}
