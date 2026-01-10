import { createWorker } from 'dynamic-worker-bundler';
import { describe, expect, it } from 'vitest';

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
});
