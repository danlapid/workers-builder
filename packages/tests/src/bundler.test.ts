import {
  createWorker,
  getOutputPath,
  isTypeScriptFile,
  parseImports,
  resolveModule,
  transformCode,
} from 'dynamic-worker-bundler';
import { describe, expect, it } from 'vitest';

describe('transformCode', () => {
  it('should transform TypeScript to JavaScript', () => {
    const code = `
      interface User {
        name: string;
        age: number;
      }
      
      export function greet(user: User): string {
        return \`Hello, \${user.name}!\`;
      }
    `;

    const result = transformCode(code, { filePath: 'test.ts' });
    expect(result.code).not.toContain('interface');
    expect(result.code).not.toContain(': User');
    expect(result.code).not.toContain(': string');
    expect(result.code).toContain('export function greet');
  });

  it('should transform JSX', () => {
    const code = `
      export function App() {
        return <div>Hello</div>;
      }
    `;

    const result = transformCode(code, { filePath: 'test.tsx' });
    expect(result.code).not.toContain('<div>');
    expect(result.code).toContain('jsx');
  });

  it('should pass through plain JavaScript', () => {
    const code = `export const x = 1;`;
    const result = transformCode(code, { filePath: 'test.js' });
    expect(result.code).toBe(code);
  });
});

describe('parseImports', () => {
  it('should parse ES module imports', () => {
    const code = `
      import foo from 'foo';
      import { bar } from 'bar';
      import * as baz from 'baz';
      import 'side-effect';
    `;

    const imports = parseImports(code);
    expect(imports).toContain('foo');
    expect(imports).toContain('bar');
    expect(imports).toContain('baz');
    expect(imports).toContain('side-effect');
  });

  it('should parse dynamic imports', () => {
    const code = `
      const mod = await import('dynamic');
      import('another-dynamic');
    `;

    const imports = parseImports(code);
    expect(imports).toContain('dynamic');
    expect(imports).toContain('another-dynamic');
  });

  it('should parse export from', () => {
    const code = `
      export { foo } from 'foo-module';
      export * from 'all-module';
    `;

    const imports = parseImports(code);
    expect(imports).toContain('foo-module');
    expect(imports).toContain('all-module');
  });

  it('should deduplicate imports', () => {
    const code = `
      import foo from 'foo';
      import { bar } from 'foo';
    `;

    const imports = parseImports(code);
    expect(imports.filter((i) => i === 'foo').length).toBe(1);
  });
});

describe('resolveModule', () => {
  it('should resolve relative imports', () => {
    const files = {
      'src/index.ts': '',
      'src/utils.ts': '',
    };

    const result = resolveModule('./utils', {
      files,
      importer: 'src/index.ts',
    });

    expect(result.path).toBe('src/utils.ts');
    expect(result.external).toBe(false);
  });

  it('should resolve with extension detection', () => {
    const files = {
      'src/index.ts': '',
      'src/helper.ts': '',
    };

    const result = resolveModule('./helper', {
      files,
      importer: 'src/index.ts',
    });

    expect(result.path).toBe('src/helper.ts');
  });

  it('should resolve index files', () => {
    const files = {
      'src/index.ts': '',
      'src/utils/index.ts': '',
    };

    const result = resolveModule('./utils', {
      files,
      importer: 'src/index.ts',
    });

    expect(result.path).toBe('src/utils/index.ts');
  });

  it('should mark unknown packages as external', () => {
    const files = {
      'src/index.ts': '',
    };

    const result = resolveModule('lodash', { files });

    expect(result.external).toBe(true);
    expect(result.path).toBe('lodash');
  });
});

describe('isTypeScriptFile', () => {
  it('should identify TypeScript files', () => {
    expect(isTypeScriptFile('foo.ts')).toBe(true);
    expect(isTypeScriptFile('foo.tsx')).toBe(true);
    expect(isTypeScriptFile('foo.mts')).toBe(true);
    expect(isTypeScriptFile('foo.js')).toBe(false);
    expect(isTypeScriptFile('foo.jsx')).toBe(false);
  });
});

describe('getOutputPath', () => {
  it('should convert TypeScript paths to JavaScript', () => {
    expect(getOutputPath('foo.ts')).toBe('foo.js');
    expect(getOutputPath('foo.tsx')).toBe('foo.js');
    expect(getOutputPath('foo.mts')).toBe('foo.mjs');
  });
});

describe('createWorker', () => {
  it('should create a worker from simple TypeScript files', async () => {
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
      bundle: false, // Skip bundling for this test
    });

    expect(result.mainModule).toBe('src/index.js');
    expect(result.modules).toHaveProperty('src/index.js');
    expect(result.modules['src/index.js']).not.toContain(': Request');
    expect(result.modules['src/index.js']).not.toContain(': Response');
  });

  it('should detect entry point from package.json', async () => {
    const result = await createWorker({
      files: {
        'worker.ts': 'export default {};',
        'package.json': JSON.stringify({ main: 'worker.ts' }),
      },
      bundle: false,
    });

    expect(result.mainModule).toBe('worker.js');
  });

  it('should use default entry point', async () => {
    const result = await createWorker({
      files: {
        'src/index.ts': 'export default {};',
      },
      bundle: false,
    });

    expect(result.mainModule).toBe('src/index.js');
  });

  it('should handle multiple files with imports', async () => {
    const result = await createWorker({
      files: {
        'src/index.ts': `
          import { greet } from './utils';
          export default { fetch: () => new Response(greet('World')) };
        `,
        'src/utils.ts': `
          export function greet(name: string): string {
            return 'Hello, ' + name;
          }
        `,
      },
      bundle: false,
    });

    expect(result.mainModule).toBe('src/index.js');
    expect(result.modules).toHaveProperty('src/index.js');
    expect(result.modules).toHaveProperty('src/utils.js');
  });

  it('should rewrite imports to use correct paths', async () => {
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

    expect(result.modules).toHaveProperty('src/index.js');
    expect(result.modules).toHaveProperty('src/helpers/utils.js');

    // The import should be rewritten to the .js extension
    const mainCode = result.modules['src/index.js'];
    expect(typeof mainCode).toBe('string');
    expect(mainCode as string).toContain('./helpers/utils.js');
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


