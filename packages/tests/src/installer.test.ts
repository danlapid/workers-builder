import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasDependencies,
  installDependencies,
} from '../../dynamic-worker-bundler/src/installer.js';

/**
 * Create a minimal tar archive with the given files.
 * TAR format: 512-byte header + content padded to 512 bytes per file.
 */
function createTarball(files: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const [name, content] of Object.entries(files)) {
    // npm tarballs have files under "package/" prefix
    const fullName = `package/${name}`;
    const contentBytes = encoder.encode(content);

    // Create 512-byte header
    const header = new Uint8Array(512);

    // Name (0-99)
    const nameBytes = encoder.encode(fullName);
    header.set(nameBytes.slice(0, 100), 0);

    // Mode (100-107) - "0000644\0"
    header.set(encoder.encode('0000644\0'), 100);

    // UID (108-115) - "0000000\0"
    header.set(encoder.encode('0000000\0'), 108);

    // GID (116-123) - "0000000\0"
    header.set(encoder.encode('0000000\0'), 116);

    // Size (124-135) - octal, 11 chars + null
    const sizeOctal = contentBytes.length.toString(8).padStart(11, '0');
    header.set(encoder.encode(`${sizeOctal}\0`), 124);

    // Mtime (136-147) - "00000000000\0"
    header.set(encoder.encode('00000000000\0'), 136);

    // Checksum placeholder (148-155) - spaces for now
    header.set(encoder.encode('        '), 148);

    // Type flag (156) - '0' for regular file
    header[156] = 48; // ASCII '0'

    // Calculate checksum (sum of all bytes, treating checksum field as spaces)
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i] ?? 0;
    }
    const checksumOctal = checksum.toString(8).padStart(6, '0');
    header.set(encoder.encode(`${checksumOctal}\0 `), 148);

    blocks.push(header);

    // Content block(s) - padded to 512 bytes
    const paddedSize = Math.ceil(contentBytes.length / 512) * 512;
    const contentBlock = new Uint8Array(paddedSize);
    contentBlock.set(contentBytes);
    blocks.push(contentBlock);
  }

  // Two empty 512-byte blocks to end the archive
  blocks.push(new Uint8Array(1024));

  // Concatenate all blocks
  const totalSize = blocks.reduce((sum, b) => sum + b.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const block of blocks) {
    result.set(block, offset);
    offset += block.length;
  }

  return result;
}

/**
 * Gzip compress data using CompressionStream.
 */
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(data).catch(() => {});
  writer.close().catch(() => {});

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Create mock npm registry metadata for a package.
 */
function createPackageMetadata(
  name: string,
  versions: { version: string; dependencies?: Record<string, string>; tarballUrl?: string }[],
  distTags: Record<string, string> = {}
) {
  const versionsObj: Record<string, unknown> = {};

  for (const v of versions) {
    versionsObj[v.version] = {
      name,
      version: v.version,
      main: 'index.js',
      dependencies: v.dependencies ?? {},
      dist: {
        tarball: v.tarballUrl ?? `https://registry.npmjs.org/${name}/-/${name}-${v.version}.tgz`,
      },
    };
  }

  return {
    name,
    'dist-tags': {
      latest: versions[versions.length - 1]?.version ?? '1.0.0',
      ...distTags,
    },
    versions: versionsObj,
  };
}

describe('hasDependencies', () => {
  it('should return true when package.json has dependencies', () => {
    const files = {
      'package.json': JSON.stringify({
        dependencies: { lodash: '^4.0.0' },
      }),
    };
    expect(hasDependencies(files)).toBe(true);
  });

  it('should return false when package.json has no dependencies', () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'my-app',
      }),
    };
    expect(hasDependencies(files)).toBe(false);
  });

  it('should return false when package.json has empty dependencies', () => {
    const files = {
      'package.json': JSON.stringify({
        dependencies: {},
      }),
    };
    expect(hasDependencies(files)).toBe(false);
  });

  it('should return false when no package.json exists', () => {
    const files = {
      'index.ts': 'export default {}',
    };
    expect(hasDependencies(files)).toBe(false);
  });

  it('should return false when package.json is invalid JSON', () => {
    const files = {
      'package.json': 'not valid json',
    };
    expect(hasDependencies(files)).toBe(false);
  });

  it('should ignore devDependencies', () => {
    const files = {
      'package.json': JSON.stringify({
        devDependencies: { typescript: '^5.0.0' },
      }),
    };
    expect(hasDependencies(files)).toBe(false);
  });
});

describe('installDependencies', () => {
  let originalFetch: typeof fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should return unchanged files when no package.json', async () => {
    const files = { 'index.ts': 'export default {}' };
    const result = await installDependencies(files);

    expect(result.files).toEqual(files);
    expect(result.installed).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return unchanged files when no dependencies', async () => {
    const files = {
      'package.json': JSON.stringify({ name: 'my-app' }),
    };
    const result = await installDependencies(files);

    expect(result.files).toEqual(files);
    expect(result.installed).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should warn on invalid package.json', async () => {
    const files = {
      'package.json': 'not valid json',
    };
    const result = await installDependencies(files);

    expect(result.warnings).toContain('Failed to parse package.json');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should install a simple package', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'test-pkg', version: '1.0.0' }),
        'index.js': 'module.exports = "hello";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/test-pkg') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(createPackageMetadata('test-pkg', [{ version: '1.0.0' }]))
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'test-pkg': '^1.0.0' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.installed).toContain('test-pkg@1.0.0');
    expect(result.files['node_modules/test-pkg/package.json']).toBeDefined();
    expect(result.files['node_modules/test-pkg/index.js']).toBe('module.exports = "hello";');
    expect(result.warnings).toEqual([]);
  });

  it('should install package with transitive dependencies', async () => {
    const parentTarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({
          name: 'parent-pkg',
          version: '2.0.0',
          dependencies: { 'child-pkg': '^1.0.0' },
        }),
        'index.js': 'module.exports = require("child-pkg");',
      })
    );

    const childTarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'child-pkg', version: '1.5.0' }),
        'index.js': 'module.exports = "child";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/parent-pkg') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('parent-pkg', [
              { version: '2.0.0', dependencies: { 'child-pkg': '^1.0.0' } },
            ])
          )
        );
      }
      if (url.includes('/child-pkg') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(createPackageMetadata('child-pkg', [{ version: '1.5.0' }]))
        );
      }
      if (url.includes('parent-pkg') && url.includes('.tgz')) {
        return new Response(parentTarball);
      }
      if (url.includes('child-pkg') && url.includes('.tgz')) {
        return new Response(childTarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'parent-pkg': '^2.0.0' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.installed).toContain('parent-pkg@2.0.0');
    expect(result.installed).toContain('child-pkg@1.5.0');
    expect(result.files['node_modules/parent-pkg/index.js']).toBeDefined();
    expect(result.files['node_modules/child-pkg/index.js']).toBeDefined();
  });

  it('should handle scoped packages', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: '@scope/pkg', version: '1.0.0' }),
        'index.js': 'module.exports = "scoped";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      // Scoped packages are encoded as @scope%2Fpkg
      if (url.includes('@scope%2Fpkg') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(createPackageMetadata('@scope/pkg', [{ version: '1.0.0' }]))
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { '@scope/pkg': '^1.0.0' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.installed).toContain('@scope/pkg@1.0.0');
    expect(result.files['node_modules/@scope/pkg/index.js']).toBe('module.exports = "scoped";');
  });

  it('should resolve semver ranges correctly', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'semver-test', version: '1.2.3' }),
        'index.js': 'module.exports = "1.2.3";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/semver-test') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('semver-test', [
              { version: '1.0.0' },
              { version: '1.1.0' },
              { version: '1.2.3' },
              { version: '2.0.0' },
            ])
          )
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'semver-test': '^1.0.0' },
      }),
    };

    const result = await installDependencies(files);

    // Should resolve ^1.0.0 to 1.2.3 (highest 1.x)
    expect(result.installed).toContain('semver-test@1.2.3');
  });

  it('should resolve tilde ranges correctly', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'tilde-test', version: '1.2.5' }),
        'index.js': 'module.exports = "1.2.5";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/tilde-test') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('tilde-test', [
              { version: '1.2.0' },
              { version: '1.2.5' },
              { version: '1.3.0' },
            ])
          )
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'tilde-test': '~1.2.0' },
      }),
    };

    const result = await installDependencies(files);

    // Should resolve ~1.2.0 to 1.2.5 (highest 1.2.x)
    expect(result.installed).toContain('tilde-test@1.2.5');
  });

  it('should resolve dist-tags', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'tag-test', version: '3.0.0-beta.1' }),
        'index.js': 'module.exports = "beta";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/tag-test') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('tag-test', [{ version: '2.0.0' }, { version: '3.0.0-beta.1' }], {
              latest: '2.0.0',
              beta: '3.0.0-beta.1',
            })
          )
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'tag-test': 'beta' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.installed).toContain('tag-test@3.0.0-beta.1');
  });

  it('should resolve "latest" tag', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'latest-test', version: '5.0.0' }),
        'index.js': 'module.exports = "latest";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/latest-test') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('latest-test', [{ version: '4.0.0' }, { version: '5.0.0' }])
          )
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'latest-test': 'latest' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.installed).toContain('latest-test@5.0.0');
  });

  it('should warn when package fetch fails', async () => {
    mockFetch.mockResolvedValue(new Response('Not found', { status: 404 }));

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'nonexistent-pkg': '^1.0.0' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.installed).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('nonexistent-pkg');
  });

  it('should warn when version cannot be resolved', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (!url.includes('.tgz')) {
        return new Response(
          JSON.stringify(createPackageMetadata('old-pkg', [{ version: '0.1.0' }]))
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'old-pkg': '^5.0.0' }, // No 5.x exists
      }),
    };

    const result = await installDependencies(files);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Could not resolve version');
  });

  it('should use custom registry', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'custom-pkg', version: '1.0.0' }),
        'index.js': 'module.exports = "custom";',
      })
    );

    const customRegistry = 'https://custom.registry.com';
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith(customRegistry) && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('custom-pkg', [
              {
                version: '1.0.0',
                tarballUrl: `${customRegistry}/custom-pkg/-/custom-pkg-1.0.0.tgz`,
              },
            ])
          )
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'custom-pkg': '^1.0.0' },
      }),
    };

    const result = await installDependencies(files, { registry: customRegistry });

    expect(result.installed).toContain('custom-pkg@1.0.0');
    // Verify the custom registry was called
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(customRegistry),
      expect.anything()
    );
  });

  it('should not install devDependencies by default', async () => {
    const files = {
      'package.json': JSON.stringify({
        devDependencies: { typescript: '^5.0.0' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.installed).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should install devDependencies when dev option is true', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'dev-pkg', version: '1.0.0' }),
        'index.js': 'module.exports = "dev";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/dev-pkg') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(createPackageMetadata('dev-pkg', [{ version: '1.0.0' }]))
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        devDependencies: { 'dev-pkg': '^1.0.0' },
      }),
    };

    const result = await installDependencies(files, { dev: true });

    expect(result.installed).toContain('dev-pkg@1.0.0');
  });

  it('should skip binary files in tarball', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'with-binary', version: '1.0.0' }),
        'index.js': 'module.exports = "text";',
        'image.png': 'fake binary content', // Would be filtered by isTextFile
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/with-binary') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(createPackageMetadata('with-binary', [{ version: '1.0.0' }]))
        );
      }
      if (url.includes('.tgz')) {
        return new Response(tarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'with-binary': '^1.0.0' },
      }),
    };

    const result = await installDependencies(files);

    expect(result.files['node_modules/with-binary/index.js']).toBeDefined();
    expect(result.files['node_modules/with-binary/image.png']).toBeUndefined();
  });

  it('should handle circular dependencies without infinite loop', async () => {
    const pkgATarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({
          name: 'pkg-a',
          version: '1.0.0',
          dependencies: { 'pkg-b': '^1.0.0' },
        }),
        'index.js': 'module.exports = "a";',
      })
    );

    const pkgBTarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({
          name: 'pkg-b',
          version: '1.0.0',
          dependencies: { 'pkg-a': '^1.0.0' },
        }),
        'index.js': 'module.exports = "b";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/pkg-a') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('pkg-a', [
              { version: '1.0.0', dependencies: { 'pkg-b': '^1.0.0' } },
            ])
          )
        );
      }
      if (url.includes('/pkg-b') && !url.includes('.tgz')) {
        return new Response(
          JSON.stringify(
            createPackageMetadata('pkg-b', [
              { version: '1.0.0', dependencies: { 'pkg-a': '^1.0.0' } },
            ])
          )
        );
      }
      if (url.includes('pkg-a') && url.includes('.tgz')) {
        return new Response(pkgATarball);
      }
      if (url.includes('pkg-b') && url.includes('.tgz')) {
        return new Response(pkgBTarball);
      }
      return new Response('Not found', { status: 404 });
    });

    const files = {
      'package.json': JSON.stringify({
        dependencies: { 'pkg-a': '^1.0.0' },
      }),
    };

    // Should complete without hanging
    const result = await installDependencies(files);

    expect(result.installed).toContain('pkg-a@1.0.0');
    expect(result.installed).toContain('pkg-b@1.0.0');
    // Each package should only be installed once
    expect(result.installed.filter((p) => p.startsWith('pkg-a@')).length).toBe(1);
    expect(result.installed.filter((p) => p.startsWith('pkg-b@')).length).toBe(1);
  });

  it('should preserve original files', async () => {
    const tarball = await gzip(
      createTarball({
        'package.json': JSON.stringify({ name: 'preserve-test', version: '1.0.0' }),
        'index.js': 'module.exports = "test";',
      })
    );

    mockFetch.mockImplementation(async (url: string) => {
      if (!url.includes('.tgz')) {
        return new Response(
          JSON.stringify(createPackageMetadata('preserve-test', [{ version: '1.0.0' }]))
        );
      }
      return new Response(tarball);
    });

    const originalFiles = {
      'package.json': JSON.stringify({
        dependencies: { 'preserve-test': '^1.0.0' },
      }),
      'src/index.ts': 'export default {}',
      'README.md': '# My Project',
    };

    const result = await installDependencies(originalFiles);

    // Original files should be preserved
    expect(result.files['package.json']).toBe(originalFiles['package.json']);
    expect(result.files['src/index.ts']).toBe(originalFiles['src/index.ts']);
    expect(result.files['README.md']).toBe(originalFiles['README.md']);
    // New files should be added
    expect(result.files['node_modules/preserve-test/index.js']).toBeDefined();
  });
});
