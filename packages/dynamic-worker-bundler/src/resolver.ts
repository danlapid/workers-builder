import { init as initLexer, parse as parseLexer } from 'es-module-lexer';
import * as resolveExports from 'resolve.exports';
import type { Files } from './types.js';

// Track lexer initialization state
let lexerInitialized = false;

export interface ResolveOptions {
  /**
   * All files in the virtual file system
   */
  files: Files;

  /**
   * Directory of the importing file (relative to root)
   */
  importer?: string;

  /**
   * Conditions for exports resolution (e.g., 'import', 'require', 'browser')
   */
  conditions?: string[];

  /**
   * Extensions to try when resolving
   */
  extensions?: string[];
}

export interface ResolveResult {
  /**
   * Resolved path (relative to root)
   */
  path: string;

  /**
   * Whether this is an external module (npm package not in files)
   */
  external: boolean;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.json'];

/**
 * Resolve a module specifier to a file path in the virtual file system.
 *
 * Handles:
 * - Relative imports (./foo, ../bar)
 * - Package imports (lodash, @scope/pkg)
 * - Package.json exports field
 * - Extension resolution (.ts, .tsx, .js, etc.)
 * - Index file resolution (foo/index.ts)
 *
 * @param specifier - The import specifier (e.g., './utils', 'lodash')
 * @param options - Resolution options
 * @returns Resolved path or external marker
 */
export function resolveModule(specifier: string, options: ResolveOptions): ResolveResult {
  const {
    files,
    importer = '',
    conditions = ['import', 'browser'],
    extensions = DEFAULT_EXTENSIONS,
  } = options;

  // Handle relative imports
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const resolved = resolveRelative(specifier, importer, files, extensions);
    if (resolved) {
      return { path: resolved, external: false };
    }
    // Relative import not found
    throw new Error(`Cannot resolve relative import '${specifier}' from '${importer}'`);
  }

  // Handle bare specifiers (npm packages)
  return resolvePackage(specifier, files, conditions, extensions);
}

/**
 * Resolve a relative import
 */
function resolveRelative(
  specifier: string,
  importer: string,
  files: Files,
  extensions: string[]
): string | undefined {
  // Get the directory of the importer
  const importerDir = getDirectory(importer);

  // Resolve the path
  const resolved = joinPaths(importerDir, specifier);

  return resolveWithExtensions(resolved, files, extensions);
}

/**
 * Resolve a package specifier
 */
function resolvePackage(
  specifier: string,
  files: Files,
  conditions: string[],
  extensions: string[]
): ResolveResult {
  // Parse the specifier
  const { packageName, subpath } = parsePackageSpecifier(specifier);

  // Look for the package in node_modules
  const packageJsonPath = `node_modules/${packageName}/package.json`;
  const packageJson = files[packageJsonPath];

  if (!packageJson) {
    // Package not found in files, mark as external
    return { path: specifier, external: true };
  }

  // Parse package.json
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(packageJson) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid package.json for ${packageName}`);
  }

  // Use resolve.exports to handle the exports field
  const entrySubpath = subpath ? `./${subpath}` : '.';

  try {
    const resolved = resolveExports.resolve(pkg, entrySubpath, { conditions });
    if (resolved && resolved.length > 0) {
      // resolve.exports returns relative paths like './dist/index.js'
      const resolvedPath = resolved[0];
      if (resolvedPath) {
        const fullPath = `node_modules/${packageName}/${normalizeRelativePath(resolvedPath)}`;
        if (fullPath in files) {
          return { path: fullPath, external: false };
        }
      }
    }
  } catch {
    // resolve.exports failed, try legacy resolution
  }

  // Fall back to legacy resolution (main, module fields)
  const legacyEntry = resolveExports.legacy(pkg, { fields: ['module', 'main'] });
  if (legacyEntry && typeof legacyEntry === 'string') {
    const fullPath = `node_modules/${packageName}/${normalizeRelativePath(legacyEntry)}`;
    if (fullPath in files) {
      return { path: fullPath, external: false };
    }
  }

  // Try index files directly
  const indexPath = resolveWithExtensions(
    `node_modules/${packageName}${subpath ? `/${subpath}` : ''}`,
    files,
    extensions
  );
  if (indexPath) {
    return { path: indexPath, external: false };
  }

  // Package found but entry point not resolved, mark as external
  return { path: specifier, external: true };
}

/**
 * Try to resolve a path with various extensions and index files
 */
function resolveWithExtensions(
  path: string,
  files: Files,
  extensions: string[]
): string | undefined {
  // Normalize the path
  const normalized = normalizePath(path);

  // Try exact match first
  if (normalized in files) {
    return normalized;
  }

  // Try adding extensions
  for (const ext of extensions) {
    const withExt = normalized + ext;
    if (withExt in files) {
      return withExt;
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = `${normalized}/index${ext}`;
    if (indexPath in files) {
      return indexPath;
    }
  }

  return undefined;
}

/**
 * Parse a package specifier into package name and subpath
 */
function parsePackageSpecifier(specifier: string): {
  packageName: string;
  subpath: string | undefined;
} {
  // Handle scoped packages (@scope/pkg)
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length >= 2) {
      const packageName = `${parts[0]}/${parts[1]}`;
      const subpath = parts.slice(2).join('/') || undefined;
      return { packageName, subpath };
    }
  }

  // Handle regular packages
  const slashIndex = specifier.indexOf('/');
  if (slashIndex === -1) {
    return { packageName: specifier, subpath: undefined };
  }

  return {
    packageName: specifier.slice(0, slashIndex),
    subpath: specifier.slice(slashIndex + 1),
  };
}

/**
 * Get the directory of a file path
 */
function getDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return '';
  }
  return filePath.slice(0, lastSlash);
}

/**
 * Join two paths
 */
function joinPaths(base: string, relative: string): string {
  if (relative.startsWith('/')) {
    return relative.slice(1);
  }

  const baseParts = base ? base.split('/') : [];
  const relativeParts = relative.split('/');

  for (const part of relativeParts) {
    if (part === '..') {
      baseParts.pop();
    } else if (part !== '.') {
      baseParts.push(part);
    }
  }

  return baseParts.join('/');
}

/**
 * Normalize a path (remove ./ prefix, handle multiple slashes)
 */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

/**
 * Normalize a relative path from package.json
 */
function normalizeRelativePath(path: string): string {
  if (path.startsWith('./')) {
    return path.slice(2);
  }
  if (path.startsWith('/')) {
    return path.slice(1);
  }
  return path;
}

/**
 * Parse imports from a JavaScript/TypeScript source file.
 *
 * This is a simple regex-based parser that handles common import patterns.
 * It doesn't handle all edge cases but works for most practical use cases.
 */
export function parseImports(code: string): string[] {
  const imports: string[] = [];

  // Match ES module imports
  // import foo from 'bar'
  // import { foo } from 'bar'
  // import * as foo from 'bar'
  // import 'bar'
  const importRegex = /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(importRegex)) {
    const specifier = match[1];
    if (specifier) {
      imports.push(specifier);
    }
  }

  // Match dynamic imports
  // import('bar')
  // await import('bar')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of code.matchAll(dynamicImportRegex)) {
    const specifier = match[1];
    if (specifier) {
      imports.push(specifier);
    }
  }

  // Match export from
  // export { foo } from 'bar'
  // export * from 'bar'
  const exportFromRegex = /export\s+(?:[\w*{}\s,]+\s+)?from\s+['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(exportFromRegex)) {
    const specifier = match[1];
    if (specifier) {
      imports.push(specifier);
    }
  }

  return [...new Set(imports)]; // Deduplicate
}

/**
 * Parse imports from a JavaScript/TypeScript source file using es-module-lexer.
 *
 * This is faster and more accurate than the regex-based parser,
 * but requires async initialization.
 *
 * @param code - The source code to parse
 * @returns Array of import specifiers
 */
export async function parseImportsAsync(code: string): Promise<string[]> {
  if (!lexerInitialized) {
    await initLexer;
    lexerInitialized = true;
  }

  const [imports] = parseLexer(code);

  return [
    ...new Set(
      imports
        .filter((imp) => imp.n !== undefined) // Only include imports with specifiers
        .map((imp) => imp.n as string)
    ),
  ];
}
