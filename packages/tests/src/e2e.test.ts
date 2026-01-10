/**
 * End-to-end tests for the playground API.
 *
 * These tests require the playground to be running:
 *   cd examples/basic && pnpm wrangler dev --port 8787
 *
 * Run with:
 *   PLAYGROUND_URL=http://localhost:8787 pnpm vitest run src/e2e.test.ts
 *
 * Note: These tests are skipped by default since they require external services.
 * They test the full integration: GitHub fetch → esbuild bundle → Worker Loader execution
 */
import { describe, expect, it } from 'vitest';

const PLAYGROUND_URL = process.env.PLAYGROUND_URL || 'http://localhost:8787';
const SKIP_E2E = !process.env.PLAYGROUND_URL;

describe.skipIf(SKIP_E2E)('End-to-End Playground Tests', () => {
  it('should import files from GitHub via /api/github', async () => {
    const response = await fetch(`${PLAYGROUND_URL}/api/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/honojs/starter/tree/main/templates/cloudflare-workers',
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data.error).toBeUndefined();
    expect(data.files).toBeDefined();
    expect(data.files['src/index.ts']).toBeDefined();
    expect(data.files['package.json']).toBeDefined();

    // Verify source info
    expect(data.source.owner).toBe('honojs');
    expect(data.source.repo).toBe('starter');
  }, 30000);

  it('should bundle and execute Hono worker via /api/run', async () => {
    // First, fetch the files from GitHub
    const githubResponse = await fetch(`${PLAYGROUND_URL}/api/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/honojs/starter/tree/main/templates/cloudflare-workers',
      }),
    });

    const { files } = await githubResponse.json();

    // Now run the worker
    const runResponse = await fetch(`${PLAYGROUND_URL}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files,
        version: Date.now(), // Unique version for this test
      }),
    });

    expect(runResponse.ok).toBe(true);
    const result = await runResponse.json();

    // Should not have an error
    expect(result.error).toBeUndefined();

    // Should have bundle info
    expect(result.bundleInfo).toBeDefined();
    expect(result.bundleInfo.mainModule).toBe('bundle.js');
    expect(result.bundleInfo.modules).toContain('bundle.js');

    // Should have response from the worker
    expect(result.response).toBeDefined();
    expect(result.response.status).toBe(200);
    // Hono starter returns "Hello Hono!" at root
    expect(result.response.body).toContain('Hello');

    console.log('Execution result:', {
      bundleInfo: result.bundleInfo,
      responseStatus: result.response.status,
      responseBody: result.response.body,
      executionTime: result.executionTime,
    });
  }, 90000);

  it('should handle simple worker without dependencies', async () => {
    const files = {
      'src/index.ts': `
        export default {
          fetch(request: Request): Response {
            return new Response('Hello from test worker!');
          }
        }
      `,
      'package.json': JSON.stringify({ name: 'test-worker', main: 'src/index.ts' }),
    };

    const response = await fetch(`${PLAYGROUND_URL}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files,
        version: Date.now(),
      }),
    });

    expect(response.ok).toBe(true);
    const result = await response.json();

    expect(result.error).toBeUndefined();
    expect(result.response.status).toBe(200);
    expect(result.response.body).toBe('Hello from test worker!');
  }, 30000);

  it('should handle multi-file workers with imports', async () => {
    const files = {
      'src/index.ts': `
        import { greet } from './utils';
        export default {
          fetch(request: Request): Response {
            return new Response(greet('World'));
          }
        }
      `,
      'src/utils.ts': `
        export function greet(name: string): string {
          return 'Hello, ' + name + '!';
        }
      `,
      'package.json': JSON.stringify({ name: 'multi-file-worker', main: 'src/index.ts' }),
    };

    const response = await fetch(`${PLAYGROUND_URL}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files,
        version: Date.now(),
      }),
    });

    expect(response.ok).toBe(true);
    const result = await response.json();

    expect(result.error).toBeUndefined();
    expect(result.response.status).toBe(200);
    expect(result.response.body).toBe('Hello, World!');
  }, 30000);
});

describe.skipIf(SKIP_E2E)('GitHub Import Error Handling', () => {
  it('should return error for invalid GitHub URL', async () => {
    const response = await fetch(`${PLAYGROUND_URL}/api/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://gitlab.com/some/repo',
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  it('should return error for non-existent repository', async () => {
    const response = await fetch(`${PLAYGROUND_URL}/api/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/this-owner-does-not-exist-12345/fake-repo',
      }),
    });

    // Should return 500 with error message
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.error).toBeDefined();
  }, 10000);
});
