import { describe, expect, it } from 'vitest';
import { createWorker } from 'workers-builder';

describe('createWorker', () => {
  describe('TypeScript transformation', () => {
    it('should transform TypeScript to JavaScript', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            interface User {
              name: string;
              age: number;
            }
            
            export function greet(user: User): string {
              return \`Hello, \${user.name}!\`;
            }
            
            export default { fetch: () => new Response('ok') };
          `,
        },
        bundle: false,
      });

      const code = result.modules['src/index.js'] as string;
      expect(code).not.toContain('interface');
      expect(code).not.toContain(': User');
      expect(code).not.toContain(': string');
      expect(code).toContain('export function greet');
    });

    it('should transform JSX', async () => {
      const result = await createWorker({
        files: {
          'src/index.tsx': `
            export function App() {
              return <div>Hello</div>;
            }
            
            export default { fetch: () => new Response('ok') };
          `,
        },
        entryPoint: 'src/index.tsx',
        bundle: false,
      });

      const code = result.modules['src/index.js'] as string;
      expect(code).not.toContain('<div>');
      expect(code).toContain('jsx');
    });

    it('should pass through plain JavaScript', async () => {
      const jsCode = `export default { fetch: () => new Response('ok') };`;
      const result = await createWorker({
        files: {
          'src/index.js': jsCode,
        },
        bundle: false,
      });

      expect(result.modules['src/index.js']).toBe(jsCode);
    });
  });

  describe('module resolution', () => {
    it('should resolve relative imports', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import { helper } from './utils';
            export default { fetch: () => new Response(helper()) };
          `,
          'src/utils.ts': `
            export function helper(): string { return 'test'; }
          `,
        },
        bundle: false,
      });

      expect(result.modules).toHaveProperty('src/index.js');
      expect(result.modules).toHaveProperty('src/utils.js');
    });

    it('should resolve imports without extension', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import { helper } from './helper';
            export default { fetch: () => new Response(helper()) };
          `,
          'src/helper.ts': `
            export function helper(): string { return 'test'; }
          `,
        },
        bundle: false,
      });

      expect(result.modules).toHaveProperty('src/helper.js');
    });

    it('should resolve index files', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import { util } from './utils';
            export default { fetch: () => new Response(util()) };
          `,
          'src/utils/index.ts': `
            export function util(): string { return 'test'; }
          `,
        },
        bundle: false,
      });

      expect(result.modules).toHaveProperty('src/utils/index.js');
    });

    it('should handle nested directory imports', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import { a } from './lib/a';
            export default { fetch: () => new Response(a()) };
          `,
          'src/lib/a.ts': `
            import { b } from './b';
            export function a(): string { return b(); }
          `,
          'src/lib/b.ts': `
            export function b(): string { return 'hello'; }
          `,
        },
        bundle: false,
      });

      expect(result.modules).toHaveProperty('src/index.js');
      expect(result.modules).toHaveProperty('src/lib/a.js');
      expect(result.modules).toHaveProperty('src/lib/b.js');
    });
  });

  describe('import rewriting', () => {
    it('should rewrite .ts imports to .js', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import { helper } from './helpers/utils';
            export default { fetch: () => new Response(helper()) };
          `,
          'src/helpers/utils.ts': `
            export function helper(): string { return 'test'; }
          `,
        },
        bundle: false,
      });

      const mainCode = result.modules['src/index.js'] as string;
      expect(mainCode).toContain('./helpers/utils.js');
    });
  });

  describe('externals', () => {
    it('should treat cloudflare:* imports as external by default', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import { WorkerEntrypoint } from 'cloudflare:workers';
            export class MyWorker extends WorkerEntrypoint {
              fetch() { return new Response('ok'); }
            }
          `,
        },
      });

      const code = result.modules['bundle.js'] as string;
      // esbuild uses double quotes
      expect(code).toContain('from "cloudflare:workers"');
      expect(code).toContain('WorkerEntrypoint');
    });

    it('should treat cloudflare:* imports as external in transform mode', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import { WorkerEntrypoint } from 'cloudflare:workers';
            export class MyWorker extends WorkerEntrypoint {
              fetch() { return new Response('ok'); }
            }
          `,
        },
        bundle: false,
      });

      const code = result.modules['src/index.js'] as string;
      expect(code).toContain("from 'cloudflare:workers'");
    });

    it('should treat user-specified externals as external', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            import something from 'my-external-pkg';
            export default { fetch: () => new Response(something) };
          `,
        },
        externals: ['my-external-pkg'],
      });

      const code = result.modules['bundle.js'] as string;
      // esbuild uses double quotes
      expect(code).toContain('from "my-external-pkg"');
    });
  });

  describe('entry point detection', () => {
    it('should detect entry point from package.json main field', async () => {
      const result = await createWorker({
        files: {
          'worker.ts': 'export default { fetch: () => new Response("ok") };',
          'package.json': JSON.stringify({ main: 'worker.ts' }),
        },
        bundle: false,
      });

      expect(result.mainModule).toBe('worker.js');
    });

    it('should use default entry point (src/index.ts)', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
        },
        bundle: false,
      });

      expect(result.mainModule).toBe('src/index.js');
    });

    it('should convert TypeScript entry point to JavaScript', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': `
            export default {
              fetch(req: Request): Response {
                return new Response('Hello');
              }
            }
          `,
          'package.json': JSON.stringify({ main: 'src/index.ts' }),
        },
        bundle: false,
      });

      expect(result.mainModule).toBe('src/index.js');
      expect(result.modules).toHaveProperty('src/index.js');
      expect(result.modules['src/index.js']).not.toContain(': Request');
      expect(result.modules['src/index.js']).not.toContain(': Response');
    });
  });

  describe('wrangler config parsing', () => {
    it('should extract compatibility settings from wrangler.toml', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
          'wrangler.toml': `
name = "my-worker"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat", "streams_enable_constructors"]
          `,
        },
        bundle: false,
      });

      expect(result.wranglerConfig?.compatibilityDate).toBe('2024-01-01');
      expect(result.wranglerConfig?.compatibilityFlags).toEqual([
        'nodejs_compat',
        'streams_enable_constructors',
      ]);
    });

    it('should extract compatibility settings from wrangler.json', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
          'wrangler.json': JSON.stringify({
            name: 'my-worker',
            compatibility_date: '2024-02-01',
            compatibility_flags: ['nodejs_compat'],
          }),
        },
        bundle: false,
      });

      expect(result.wranglerConfig?.compatibilityDate).toBe('2024-02-01');
      expect(result.wranglerConfig?.compatibilityFlags).toEqual(['nodejs_compat']);
    });

    it('should extract compatibility settings from wrangler.jsonc', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
          'wrangler.jsonc': `{
            // This is a comment
            "name": "my-worker",
            "compatibility_date": "2024-03-01",
            /* Multi-line
               comment */
            "compatibility_flags": ["nodejs_compat"]
          }`,
        },
        bundle: false,
      });

      expect(result.wranglerConfig?.compatibilityDate).toBe('2024-03-01');
      expect(result.wranglerConfig?.compatibilityFlags).toEqual(['nodejs_compat']);
    });

    it('should handle camelCase format in JSON config', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
          'wrangler.json': JSON.stringify({
            name: 'my-worker',
            compatibilityDate: '2024-04-01',
            compatibilityFlags: ['nodejs_compat'],
          }),
        },
        bundle: false,
      });

      expect(result.wranglerConfig?.compatibilityDate).toBe('2024-04-01');
      expect(result.wranglerConfig?.compatibilityFlags).toEqual(['nodejs_compat']);
    });

    it('should return empty wranglerConfig if config file has no compatibility fields', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
          'wrangler.toml': `name = "my-worker"`,
        },
        bundle: false,
      });

      expect(result.wranglerConfig).toEqual({});
    });

    it('should not include wranglerConfig if no config file exists', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
        },
        bundle: false,
      });

      expect(result.wranglerConfig).toBeUndefined();
    });

    it('should prefer wrangler.toml over wrangler.json', async () => {
      const result = await createWorker({
        files: {
          'src/index.ts': 'export default { fetch: () => new Response("ok") };',
          'wrangler.toml': `compatibility_date = "2024-01-01"`,
          'wrangler.json': JSON.stringify({ compatibility_date: '2024-02-01' }),
        },
        bundle: false,
      });

      expect(result.wranglerConfig?.compatibilityDate).toBe('2024-01-01');
    });

    it('should use wrangler main field as entry point', async () => {
      const result = await createWorker({
        files: {
          'worker/handler.ts': 'export default { fetch: () => new Response("from handler") };',
          'src/index.ts': 'export default { fetch: () => new Response("from index") };',
          'wrangler.toml': `main = "worker/handler.ts"`,
        },
        bundle: false,
      });

      expect(result.mainModule).toBe('worker/handler.js');
      expect(result.wranglerConfig?.main).toBe('worker/handler.ts');
    });

    it('should normalize wrangler main field with leading ./', async () => {
      const result = await createWorker({
        files: {
          'src/worker.ts': 'export default { fetch: () => new Response("ok") };',
          'wrangler.toml': `main = "./src/worker.ts"`,
        },
        bundle: false,
      });

      expect(result.mainModule).toBe('src/worker.js');
    });

    it('should prefer wrangler main over package.json main', async () => {
      const result = await createWorker({
        files: {
          'worker/handler.ts': 'export default { fetch: () => new Response("from wrangler") };',
          'lib/index.ts': 'export default { fetch: () => new Response("from package") };',
          'wrangler.toml': `main = "worker/handler.ts"`,
          'package.json': JSON.stringify({ main: 'lib/index.ts' }),
        },
        bundle: false,
      });

      expect(result.mainModule).toBe('worker/handler.js');
    });
  });
});
