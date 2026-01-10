import { createWorker } from 'dynamic-worker-bundler';
import { describe, expect, it } from 'vitest';

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
}

/**
 * Fetch files from a GitHub directory recursively.
 * Returns paths relative to the requested directory.
 */
async function fetchGitHubDirectory(
  owner: string,
  repo: string,
  branch: string,
  basePath: string
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function fetchDir(dirPath: string): Promise<void> {
    const apiUrl = dirPath
      ? `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`
      : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;

    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'dynamic-worker-bundler-tests',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} for ${apiUrl}`);
    }

    const contents = (await response.json()) as GitHubContent | GitHubContent[];

    // Handle single file case
    if (!Array.isArray(contents)) {
      if (contents.type === 'file' && contents.download_url) {
        const fileResponse = await fetch(contents.download_url);
        if (fileResponse.ok) {
          // Make path relative to basePath
          const relativePath = basePath ? contents.path.replace(`${basePath}/`, '') : contents.path;
          files[relativePath] = await fileResponse.text();
        }
      }
      return;
    }

    // Process all items in parallel
    await Promise.all(
      contents.map(async (item) => {
        if (item.type === 'file' && item.download_url) {
          // Skip lock files
          if (isLockFile(item.name)) return;

          const fileResponse = await fetch(item.download_url);
          if (fileResponse.ok) {
            // Make path relative to basePath
            const relativePath = basePath ? item.path.replace(`${basePath}/`, '') : item.path;
            files[relativePath] = await fileResponse.text();
          }
        } else if (item.type === 'dir') {
          // Recursively fetch subdirectory
          await fetchDir(item.path);
        }
      })
    );
  }

  await fetchDir(basePath);
  return files;
}

function isLockFile(filename: string): boolean {
  return (
    filename === 'package-lock.json' ||
    filename === 'pnpm-lock.yaml' ||
    filename === 'yarn.lock' ||
    filename === 'bun.lockb'
  );
}

describe('GitHub Import Integration', () => {
  it('should fetch files from Hono starter template', async () => {
    // Fetch files from honojs/starter cloudflare-workers template
    const files = await fetchGitHubDirectory(
      'honojs',
      'starter',
      'main',
      'templates/cloudflare-workers'
    );

    // Debug: log the files we got
    console.log('Fetched files:', Object.keys(files));

    // Verify we got files
    expect(Object.keys(files).length).toBeGreaterThan(0);

    // Should have the main entry point
    const hasIndexTs = 'src/index.ts' in files || 'src/index.tsx' in files;
    expect(hasIndexTs).toBe(true);

    // Should have package.json
    expect(files['package.json']).toBeDefined();

    // package.json should reference hono dependency
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies?.hono || pkg.devDependencies?.hono).toBeDefined();
  }, 30000); // 30s timeout for network requests

  it('should transform Hono starter files (transform-only mode)', async () => {
    // Fetch files from GitHub
    const files = await fetchGitHubDirectory(
      'honojs',
      'starter',
      'main',
      'templates/cloudflare-workers'
    );

    // Use transform-only mode since esbuild-wasm doesn't work in workerd
    // This tests our ability to process the files without bundling
    const result = await createWorker({
      files,
      bundle: false, // Transform only - esbuild-wasm doesn't work in workerd tests
    });

    // Should have transformed the entry point
    expect(result.mainModule).toMatch(/index\.js$/);
    expect(result.modules[result.mainModule]).toBeDefined();

    // The transformed code should have imports (not bundled)
    const mainCode = result.modules[result.mainModule] as string;
    expect(mainCode).toContain('import');
    expect(mainCode).toContain('Hono');

    // In transform-only mode without fetchDependencies, hono is marked as external
    // The warning may or may not be present depending on implementation
    // The key thing is the transform succeeded
    console.log('Transform result:', {
      mainModule: result.mainModule,
      moduleCount: Object.keys(result.modules).length,
      warnings: result.warnings,
    });
  }, 30000);

  it('should install npm dependencies and resolve modules', async () => {
    // Fetch files from GitHub
    const files = await fetchGitHubDirectory(
      'honojs',
      'starter',
      'main',
      'templates/cloudflare-workers'
    );

    // Use transform-only mode with fetchDependencies
    // This tests the npm installer without requiring esbuild
    const result = await createWorker({
      files,
      bundle: false,
      fetchDependencies: true, // Install npm dependencies
    });

    // Should have the main module
    expect(result.mainModule).toMatch(/index\.js$/);

    // Should have installed hono and resolved its modules
    const moduleKeys = Object.keys(result.modules);
    const honoModules = moduleKeys.filter((k) => k.includes('node_modules/hono'));

    console.log('Installed modules:', {
      total: moduleKeys.length,
      honoModules: honoModules.length,
      sample: honoModules.slice(0, 5),
    });

    // Should have hono's main files in node_modules
    expect(honoModules.length).toBeGreaterThan(0);
    expect(honoModules.some((m) => m.includes('hono/dist'))).toBe(true);
  }, 60000);

  // Note: This test is skipped because:
  // 1. esbuild-wasm cannot initialize in workerd test environment
  // 2. Worker Loader binding is in closed beta and not available in miniflare
  //
  // This test works correctly in the actual playground (examples/basic)
  // where esbuild-wasm can initialize and Worker Loader is available.
  it.skip('should bundle and execute Hono worker with dependencies', async () => {
    // Fetch files from GitHub
    const files = await fetchGitHubDirectory(
      'honojs',
      'starter',
      'main',
      'templates/cloudflare-workers'
    );

    // Bundle with dependencies from esm.sh
    // Note: This requires esbuild-wasm which doesn't work in workerd tests
    const result = await createWorker({
      files,
      bundle: true,
      fetchDependencies: true,
      strictBundling: true, // Fail if bundling doesn't work
    });

    // Should produce a single bundle
    expect(result.mainModule).toBe('bundle.js');
    expect(result.modules['bundle.js']).toBeDefined();

    // Bundle should contain Hono code (inlined from CDN)
    const bundleCode = result.modules['bundle.js'] as string;
    expect(bundleCode).toContain('Hono');

    // Should not have warnings about missing dependencies
    const dependencyWarnings = result.warnings?.filter((w) => w.includes('Could not resolve'));
    expect(dependencyWarnings?.length || 0).toBe(0);
  }, 90000);
});

describe('GitHub URL Parsing', () => {
  // Test the URL parsing logic used by the playground
  function parseGitHubUrl(urlString: string): {
    owner: string;
    repo: string;
    branch: string;
    path: string;
  } | null {
    try {
      const url = new URL(urlString);
      if (url.hostname !== 'github.com') return null;

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;

      const owner = parts[0];
      const repo = parts[1];
      let branch = 'main';
      let path = '';

      if (parts.length > 2 && parts[2] === 'tree') {
        branch = parts[3] || 'main';
        path = parts.slice(4).join('/');
      }

      return { owner, repo, branch, path };
    } catch {
      return null;
    }
  }

  it('should parse simple repo URL', () => {
    const result = parseGitHubUrl('https://github.com/honojs/hono');
    expect(result).toEqual({
      owner: 'honojs',
      repo: 'hono',
      branch: 'main',
      path: '',
    });
  });

  it('should parse URL with branch', () => {
    const result = parseGitHubUrl('https://github.com/honojs/hono/tree/develop');
    expect(result).toEqual({
      owner: 'honojs',
      repo: 'hono',
      branch: 'develop',
      path: '',
    });
  });

  it('should parse URL with branch and path', () => {
    const result = parseGitHubUrl(
      'https://github.com/honojs/starter/tree/main/templates/cloudflare-workers'
    );
    expect(result).toEqual({
      owner: 'honojs',
      repo: 'starter',
      branch: 'main',
      path: 'templates/cloudflare-workers',
    });
  });

  it('should parse cloudflare templates URL', () => {
    const result = parseGitHubUrl(
      'https://github.com/cloudflare/templates/tree/main/hello-world-do-template'
    );
    expect(result).toEqual({
      owner: 'cloudflare',
      repo: 'templates',
      branch: 'main',
      path: 'hello-world-do-template',
    });
  });

  it('should return null for invalid URLs', () => {
    expect(parseGitHubUrl('https://gitlab.com/user/repo')).toBeNull();
    expect(parseGitHubUrl('not-a-url')).toBeNull();
    expect(parseGitHubUrl('https://github.com/')).toBeNull();
  });
});
