/**
 * End-to-end test for createWorker with the Hono starter template.
 *
 * This test verifies the complete pipeline:
 * 1. Input parsing (package.json, TypeScript source)
 * 2. Dependency fetching (hono from npm registry)
 * 3. TypeScript transformation (via Sucrase)
 * 4. Import resolution and rewriting
 * 5. Output module structure
 *
 * Based on: https://github.com/honojs/starter/tree/main/templates/cloudflare-workers
 */

import { describe, expect, it } from 'vitest';
import { createWorker } from 'workers-builder';

// ============================================================================
// Test Input: Hono Starter Template
// ============================================================================

const HONO_STARTER_FILES = {
  'package.json': JSON.stringify({
    type: 'module',
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy --minify',
      'cf-typegen': 'wrangler types --env-interface CloudflareBindings',
    },
    dependencies: {
      hono: '^4.11.3',
    },
    devDependencies: {
      wrangler: '^4.4.0',
    },
  }),
  'src/index.ts': `import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
`,
};

// ============================================================================
// Expected Output
// ============================================================================

const EXPECTED_MAIN_MODULE = 'src/index.js';

// The transformed main module should:
// - Have TypeScript types stripped
// - Have 'hono' import rewritten to absolute path
const EXPECTED_MAIN_MODULE_CONTENT = `import { Hono } from '/node_modules/hono/dist/index.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
`;

// Core hono modules that must be present (these are the essential ones)
const EXPECTED_HONO_MODULES = [
  'node_modules/hono/dist/index.js',
  'node_modules/hono/dist/hono.js',
  'node_modules/hono/dist/hono-base.js',
  'node_modules/hono/dist/context.js',
  'node_modules/hono/dist/request.js',
  'node_modules/hono/dist/compose.js',
  'node_modules/hono/dist/router.js',
  'node_modules/hono/dist/http-exception.js',
  // Router implementations
  'node_modules/hono/dist/router/reg-exp-router/index.js',
  'node_modules/hono/dist/router/reg-exp-router/router.js',
  'node_modules/hono/dist/router/smart-router/index.js',
  'node_modules/hono/dist/router/smart-router/router.js',
  'node_modules/hono/dist/router/trie-router/index.js',
  'node_modules/hono/dist/router/trie-router/router.js',
];

// ============================================================================
// Tests
// ============================================================================

describe('Hono Starter E2E', () => {
  it('should transform and resolve Hono starter with dependencies', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: false,
    });

    // ========================================
    // 1. Verify main module path
    // ========================================
    expect(result.mainModule).toBe(EXPECTED_MAIN_MODULE);

    // ========================================
    // 2. Verify main module content
    // ========================================
    expect(result.modules[EXPECTED_MAIN_MODULE]).toBe(EXPECTED_MAIN_MODULE_CONTENT);

    // ========================================
    // 3. Verify no warnings (all deps resolved)
    // ========================================
    expect(result.warnings).toBeUndefined();

    // ========================================
    // 4. Verify hono modules are present
    // ========================================
    const moduleKeys = Object.keys(result.modules);

    for (const expectedModule of EXPECTED_HONO_MODULES) {
      expect(moduleKeys).toContain(expectedModule);
    }

    // ========================================
    // 5. Verify module count is reasonable
    // ========================================
    // Hono has ~25-30 modules, plus our 1 source file
    expect(moduleKeys.length).toBeGreaterThanOrEqual(20);
    expect(moduleKeys.length).toBeLessThanOrEqual(50);

    // ========================================
    // 6. Verify hono/dist/index.js exports Hono
    // ========================================
    const honoIndex = result.modules['node_modules/hono/dist/index.js'] as string;
    expect(honoIndex).toContain('import { Hono }');
    expect(honoIndex).toContain('export {');
    expect(honoIndex).toContain('Hono');

    // ========================================
    // 7. Verify hono/dist/hono.js has class
    // ========================================
    const honoMain = result.modules['node_modules/hono/dist/hono.js'] as string;
    expect(honoMain).toContain('class');
    expect(honoMain).toContain('extends HonoBase');
    expect(honoMain).toContain('SmartRouter');

    // ========================================
    // 8. Verify all modules are strings
    // ========================================
    for (const [_path, content] of Object.entries(result.modules)) {
      expect(typeof content).toBe('string');
      expect((content as string).length).toBeGreaterThan(0);
    }
  }, 60000); // 60s timeout for npm fetch

  it('should have correct import rewriting in main module', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: false,
    });

    const mainContent = result.modules[EXPECTED_MAIN_MODULE] as string;

    // Should NOT have the original bare import
    expect(mainContent).not.toContain("from 'hono'");
    expect(mainContent).not.toContain('from "hono"');

    // Should have the rewritten absolute import
    expect(mainContent).toContain("from '/node_modules/hono/dist/index.js'");

    // Should NOT have TypeScript syntax
    expect(mainContent).not.toContain(': Response');
    expect(mainContent).not.toContain(': Request');
    expect(mainContent).not.toMatch(/:\s*\w+\s*[=)]/); // No type annotations
  }, 60000);

  it('should have valid import chains in hono modules', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: false,
    });

    // Verify import chain: index.js -> hono.js -> hono-base.js
    const indexJs = result.modules['node_modules/hono/dist/index.js'] as string;
    expect(indexJs).toContain('./hono.js');

    const honoJs = result.modules['node_modules/hono/dist/hono.js'] as string;
    expect(honoJs).toContain('./hono-base.js');
    expect(honoJs).toContain('./router/reg-exp-router/index.js');
    expect(honoJs).toContain('./router/smart-router/index.js');
    expect(honoJs).toContain('./router/trie-router/index.js');

    const honoBaseJs = result.modules['node_modules/hono/dist/hono-base.js'] as string;
    expect(honoBaseJs).toContain('./context.js');
    expect(honoBaseJs).toContain('./compose.js');
  }, 60000);

  it('should leave external imports unchanged when no dependencies in package.json', async () => {
    // Files with NO dependencies - hono import should be treated as external
    const filesWithoutDeps = {
      'package.json': JSON.stringify({
        name: 'test-worker',
        main: 'src/index.ts',
        // No dependencies!
      }),
      'src/index.ts': HONO_STARTER_FILES['src/index.ts'],
    };

    const result = await createWorker({
      files: filesWithoutDeps,
      bundle: false,
    });

    // Main module should still be transformed
    expect(result.mainModule).toBe(EXPECTED_MAIN_MODULE);

    // Should only have the source file (no node_modules since no deps)
    const moduleKeys = Object.keys(result.modules);
    expect(moduleKeys).toHaveLength(1);
    expect(moduleKeys).toContain('src/index.js');

    // The import should remain as 'hono' (treated as external)
    const mainContent = result.modules['src/index.js'] as string;
    expect(mainContent).toContain("from 'hono'");

    // TypeScript should still be transformed
    expect(mainContent).not.toContain(': Request');
    expect(mainContent).not.toContain(': Response');
  });
});

describe('Hono Starter Module Structure', () => {
  it('should organize modules in correct directory structure', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: false,
    });

    const moduleKeys = Object.keys(result.modules);

    // Source files in src/
    const srcModules = moduleKeys.filter((k) => k.startsWith('src/'));
    expect(srcModules).toContain('src/index.js');

    // Hono modules in node_modules/hono/dist/
    const honoModules = moduleKeys.filter((k) => k.startsWith('node_modules/hono/'));
    expect(honoModules.length).toBeGreaterThan(15);

    // All hono modules should be in dist/
    for (const mod of honoModules) {
      expect(mod).toMatch(/^node_modules\/hono\/dist\//);
    }

    // Router modules should be nested properly
    const routerModules = moduleKeys.filter((k) => k.includes('/router/'));
    expect(routerModules.length).toBeGreaterThanOrEqual(6); // At least reg-exp, smart, trie routers
  }, 60000);

  it('should not include devDependencies', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: false,
    });

    const moduleKeys = Object.keys(result.modules);

    // Should NOT have wrangler (devDependency)
    const wranglerModules = moduleKeys.filter((k) => k.includes('wrangler'));
    expect(wranglerModules).toHaveLength(0);
  }, 60000);
});

describe('Hono Starter TypeScript Transformation', () => {
  it('should handle TypeScript with type annotations', async () => {
    const filesWithTypes = {
      ...HONO_STARTER_FILES,
      'src/index.ts': `import { Hono, Context } from 'hono'

interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c: Context) => {
  return c.text('Hello Hono!')
})

export default app
`,
    };

    const result = await createWorker({
      files: filesWithTypes,
      bundle: false,
    });

    const mainContent = result.modules['src/index.js'] as string;

    // TypeScript types should be stripped
    expect(mainContent).not.toContain('interface Env');
    expect(mainContent).not.toContain(': D1Database');
    expect(mainContent).not.toContain(': Context');

    // Code should still work
    expect(mainContent).toContain('new Hono');
    expect(mainContent).toContain("c.text('Hello Hono!')");
  }, 60000);

  it('should handle JSX in .tsx files', async () => {
    const filesWithJsx = {
      'package.json': JSON.stringify({
        main: 'src/index.tsx',
        dependencies: { hono: '^4.11.3' },
      }),
      'src/index.tsx': `import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  const content = <div>Hello JSX!</div>
  return c.html(content)
})

export default app
`,
    };

    const result = await createWorker({
      files: filesWithJsx,
      bundle: false,
    });

    expect(result.mainModule).toBe('src/index.js');

    const mainContent = result.modules['src/index.js'] as string;

    // JSX should be transformed
    expect(mainContent).not.toContain('<div>');
    expect(mainContent).toContain('jsx'); // Transformed to jsx() calls
  }, 60000);
});

describe('Hono Starter Full Bundling', () => {
  it('should bundle with esbuild-wasm and tree-shake', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: true,
    });

    // Should produce a single bundled file
    const moduleKeys = Object.keys(result.modules);
    expect(moduleKeys).toHaveLength(1);
    expect(result.mainModule).toBe('bundle.js');

    const bundleContent = result.modules['bundle.js'] as string;

    // Bundle should contain Hono class
    expect(bundleContent).toContain('Hono');

    // Bundle should be smaller than all modules combined (tree-shaking)
    // Transform-only mode produces ~27 modules
    // A good bundle should be significantly smaller
    const bundleSize = bundleContent.length;
    console.log(`Bundle size: ${(bundleSize / 1024).toFixed(2)} KB`);

    // Bundle should have the app code
    expect(bundleContent).toContain('Hello Hono!');

    // Should NOT have warnings about missing modules
    expect(result.warnings).toBeUndefined();
  }, 120000); // 2 minute timeout for bundling + npm fetch

  it('should generate inline sourcemaps when enabled', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: true,
      sourcemap: true,
    });

    expect(result.mainModule).toBe('bundle.js');
    const bundleContent = result.modules['bundle.js'] as string;

    // Should contain inline sourcemap comment
    expect(bundleContent).toContain('//# sourceMappingURL=data:application/json;base64,');

    // Decode and verify sourcemap structure
    // Use a more flexible regex that handles multiline
    const sourcemapMatch = bundleContent.match(
      /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/
    );
    expect(sourcemapMatch).not.toBeNull();

    const sourcemapJson = atob(sourcemapMatch?.[1] ?? '');
    const sourcemap = JSON.parse(sourcemapJson);

    // Verify sourcemap has required fields
    expect(sourcemap.version).toBe(3);
    expect(sourcemap.sources).toBeDefined();
    expect(Array.isArray(sourcemap.sources)).toBe(true);
    expect(sourcemap.mappings).toBeDefined();
  }, 120000);

  it('should not include sourcemaps by default', async () => {
    const result = await createWorker({
      files: HONO_STARTER_FILES,
      bundle: true,
    });

    const bundleContent = result.modules['bundle.js'] as string;

    // Should NOT contain sourcemap
    expect(bundleContent).not.toContain('//# sourceMappingURL=');
  }, 120000);
});
