/**
 * NPM package installer for virtual file systems.
 *
 * This module fetches packages from the npm registry and populates
 * a virtual node_modules directory structure.
 */

import type { Files } from './types.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';

interface PackageJson {
  name: string;
  version: string;
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dist?: {
    tarball: string;
    integrity?: string;
  };
}

interface NpmPackageMetadata {
  name: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, PackageJson>;
}

interface InstallOptions {
  /**
   * Include devDependencies (default: false)
   */
  dev?: boolean;

  /**
   * Registry URL (default: https://registry.npmjs.org)
   */
  registry?: string;

  /**
   * Called when a package is being installed
   */
  onProgress?: (message: string) => void;
}

interface InstallResult {
  /**
   * Files with node_modules populated
   */
  files: Files;

  /**
   * Packages that were installed
   */
  installed: string[];

  /**
   * Warnings encountered during installation
   */
  warnings: string[];
}

/**
 * Install npm dependencies into a virtual file system.
 *
 * Reads the package.json from the files, resolves all dependencies,
 * and populates node_modules with the package contents.
 *
 * @param files - Virtual file system containing package.json
 * @param options - Installation options
 * @returns Files with node_modules populated
 */
export async function installDependencies(
  files: Files,
  options: InstallOptions = {}
): Promise<InstallResult> {
  const { dev = false, registry = NPM_REGISTRY, onProgress } = options;

  const result: InstallResult = {
    files: { ...files },
    installed: [],
    warnings: [],
  };

  // Read package.json
  const packageJsonContent = files['package.json'];
  if (!packageJsonContent) {
    return result; // No package.json, nothing to install
  }

  let packageJson: PackageJson;
  try {
    packageJson = JSON.parse(packageJsonContent) as PackageJson;
  } catch {
    result.warnings.push('Failed to parse package.json');
    return result;
  }

  // Collect dependencies to install
  const depsToInstall: Record<string, string> = {
    ...packageJson.dependencies,
    ...(dev ? packageJson.devDependencies : {}),
  };

  if (Object.keys(depsToInstall).length === 0) {
    return result; // No dependencies to install
  }

  // Track installed packages to avoid duplicates
  const installedPackages = new Map<string, string>(); // name -> version

  // Install each dependency (and its transitive deps)
  for (const [name, versionRange] of Object.entries(depsToInstall)) {
    await installPackage(name, versionRange, result, installedPackages, registry, onProgress);
  }

  return result;
}

/**
 * Install a single package and its dependencies recursively.
 */
async function installPackage(
  name: string,
  versionRange: string,
  result: InstallResult,
  installedPackages: Map<string, string>,
  registry: string,
  onProgress?: (message: string) => void
): Promise<void> {
  // Skip if already installed
  if (installedPackages.has(name)) {
    return;
  }

  try {
    // Fetch package metadata from registry
    const metadata = await fetchPackageMetadata(name, registry);

    // Resolve version from range
    const version = resolveVersion(versionRange, metadata);
    if (!version) {
      result.warnings.push(`Could not resolve version for ${name}@${versionRange}`);
      return;
    }

    // Get the specific version metadata
    const versionMetadata = metadata.versions[version];
    if (!versionMetadata) {
      result.warnings.push(`Version ${version} not found for ${name}`);
      return;
    }

    // Mark as installed (before fetching to prevent cycles)
    installedPackages.set(name, version);
    result.installed.push(`${name}@${version}`);

    // Fetch and extract the package tarball
    const packageFiles = await fetchPackageFiles(name, versionMetadata, registry);

    // Add files to node_modules
    for (const [filePath, content] of Object.entries(packageFiles)) {
      result.files[`node_modules/${name}/${filePath}`] = content;
    }

    // Install dependencies recursively
    const deps = versionMetadata.dependencies ?? {};
    for (const [depName, depVersion] of Object.entries(deps)) {
      await installPackage(depName, depVersion, result, installedPackages, registry, onProgress);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.warnings.push(`Failed to install ${name}: ${message}`);
  }
}

/**
 * Fetch package metadata from npm registry.
 */
async function fetchPackageMetadata(name: string, registry: string): Promise<NpmPackageMetadata> {
  // Handle scoped packages
  const encodedName = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : name;
  const url = `${registry}/${encodedName}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch package metadata: ${response.status}`);
  }

  return (await response.json()) as NpmPackageMetadata;
}

/**
 * Resolve a semver range to a specific version.
 */
function resolveVersion(range: string, metadata: NpmPackageMetadata): string | undefined {
  // Handle special cases
  if (range === 'latest' || range === '*') {
    return metadata['dist-tags']['latest'];
  }

  // Handle exact versions
  if (metadata.versions[range]) {
    return range;
  }

  // Handle dist-tags (e.g., "next", "beta")
  if (metadata['dist-tags'][range]) {
    return metadata['dist-tags'][range];
  }

  // For ranges like ^1.0.0, ~1.0.0, >=1.0.0, we need to find the best match
  // Simple implementation: find the highest version that starts with the major version
  const versions = Object.keys(metadata.versions);

  // Parse the range to extract constraints
  const cleanRange = range.replace(/^[\^~>=<]+/, '');
  const [majorStr] = cleanRange.split('.');
  const major = parseInt(majorStr ?? '0', 10);

  // Filter versions that match the major version (for ^ ranges)
  // This is a simplified semver matching - in production you'd use a proper semver library
  if (range.startsWith('^') || range.startsWith('~')) {
    const matchingVersions = versions
      .filter((v) => {
        const [vMajor] = v.split('.');
        return parseInt(vMajor ?? '0', 10) === major;
      })
      .sort(compareVersions)
      .reverse();

    return matchingVersions[0];
  }

  // For >= ranges, get the latest
  if (range.startsWith('>=')) {
    return metadata['dist-tags']['latest'];
  }

  // Fallback: try to find any version that might work
  const sortedVersions = versions.sort(compareVersions).reverse();
  return sortedVersions[0];
}

/**
 * Compare two semver versions.
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((p) => parseInt(p.replace(/[^0-9]/g, ''), 10) || 0);
  const bParts = b.split('.').map((p) => parseInt(p.replace(/[^0-9]/g, ''), 10) || 0);

  for (let i = 0; i < 3; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }
  return 0;
}

/**
 * Fetch and extract package files from npm tarball.
 */
async function fetchPackageFiles(
  name: string,
  metadata: PackageJson,
  _registry: string
): Promise<Record<string, string>> {
  const tarballUrl = metadata.dist?.tarball;
  if (!tarballUrl) {
    throw new Error(`No tarball URL for ${name}`);
  }

  // Fetch the tarball
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch tarball: ${response.status}`);
  }

  // Get the tarball as array buffer
  const buffer = await response.arrayBuffer();

  // Extract the tarball (npm tarballs are gzipped tar files)
  return extractTarball(new Uint8Array(buffer));
}

/**
 * Extract files from a gzipped tarball.
 *
 * npm packages are distributed as .tgz files (gzipped tar).
 * The contents are in a "package/" directory.
 */
async function extractTarball(data: Uint8Array): Promise<Record<string, string>> {
  // Decompress gzip
  const decompressed = await decompress(data);

  // Parse tar
  return parseTar(decompressed);
}

/**
 * Decompress gzip data using DecompressionStream.
 */
async function decompress(data: Uint8Array): Promise<Uint8Array> {
  // Use DecompressionStream (available in Workers and modern browsers)
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write compressed data
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});

  // Read decompressed data
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  // Concatenate chunks
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Parse a tar archive and extract text files.
 *
 * TAR format:
 * - 512-byte header blocks
 * - File content (padded to 512 bytes)
 * - Two empty blocks at the end
 */
function parseTar(data: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
  const textDecoder = new TextDecoder();
  let offset = 0;

  while (offset < data.length - 512) {
    // Read header
    const header = data.slice(offset, offset + 512);

    // Check for empty block (end of archive)
    if (header.every((b) => b === 0)) {
      break;
    }

    // Parse header fields
    const name = readString(header, 0, 100);
    const sizeStr = readString(header, 124, 12);
    const typeFlag = header[156];

    // Parse size (octal)
    const size = parseInt(sizeStr.trim(), 8) || 0;

    // Move past header
    offset += 512;

    // Only process regular files (type '0' or '\0')
    if ((typeFlag === 48 || typeFlag === 0) && size > 0) {
      // Read file content
      const content = data.slice(offset, offset + size);

      // Remove "package/" prefix from npm tarballs
      let filePath = name;
      if (filePath.startsWith('package/')) {
        filePath = filePath.slice(8);
      }

      // Only include text files (skip binary files)
      if (isTextFile(filePath)) {
        try {
          files[filePath] = textDecoder.decode(content);
        } catch {
          // Skip files that can't be decoded as text
        }
      }
    }

    // Move to next block (content is padded to 512 bytes)
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

/**
 * Read a null-terminated string from a buffer.
 */
function readString(buffer: Uint8Array, offset: number, length: number): string {
  const bytes = buffer.slice(offset, offset + length);
  const nullIndex = bytes.indexOf(0);
  const relevantBytes = nullIndex >= 0 ? bytes.slice(0, nullIndex) : bytes;
  return new TextDecoder().decode(relevantBytes);
}

/**
 * Check if a file path is likely a text file.
 */
function isTextFile(path: string): boolean {
  const textExtensions = [
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.mts',
    '.cts',
    '.tsx',
    '.jsx',
    '.json',
    '.md',
    '.txt',
    '.css',
    '.html',
    '.yml',
    '.yaml',
    '.toml',
    '.xml',
    '.svg',
    '.map',
    '.d.ts',
    '.d.mts',
    '.d.cts',
  ];

  // Check common config files without extensions
  const configFiles = [
    'LICENSE',
    'README',
    'CHANGELOG',
    'package.json',
    'tsconfig.json',
    '.npmignore',
    '.gitignore',
  ];

  const fileName = path.split('/').pop() ?? '';

  if (configFiles.some((f) => fileName.toUpperCase().startsWith(f.toUpperCase()))) {
    return true;
  }

  return textExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}
