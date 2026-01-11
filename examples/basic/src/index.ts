import { createWorker } from 'workers-builder';
import { handleGitHubImport } from './github.js';

interface BundleInfo {
  mainModule: string;
  modules: string[];
  warnings: string[];
}

// Execute a dynamic worker and return the full response
async function executeWorker(worker: WorkerStub, bundleInfo: BundleInfo): Promise<Response> {
  const startTime = Date.now();
  const testRequest = new Request('https://example.com/', { method: 'GET' });

  let workerResponse: Response;
  let responseBody: string;
  let workerError: { message: string; stack?: string } | null = null;

  try {
    workerResponse = await worker.getEntrypoint().fetch(testRequest);
    responseBody = await workerResponse.text();

    // Check if the worker returned a 500 error - this often indicates an uncaught exception
    // The Worker runtime catches exceptions and returns "Internal Server Error"
    if (workerResponse.status >= 500) {
      if (responseBody === 'Internal Server Error') {
        workerError = { message: 'Worker threw an uncaught exception.' };
      } else if (responseBody) {
        workerError = { message: responseBody };
      }
    }
  } catch (err) {
    // Worker execution failed - return this as a runtime error
    const stack = err instanceof Error ? err.stack : undefined;
    workerError = {
      message: err instanceof Error ? err.message : String(err),
      ...(stack && { stack }),
    };
    workerResponse = new Response('Worker execution failed', { status: 500 });
    responseBody = '';
  }

  const executionTime = Date.now() - startTime;

  // Get response headers
  const responseHeaders: Record<string, string> = {};
  workerResponse.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return Response.json({
    bundleInfo,
    response: {
      status: workerResponse.status,
      headers: responseHeaders,
      body: responseBody,
    },
    workerError,
    executionTime,
  });
}

// Build a JSON error response
function buildErrorResponse(error: unknown): Response {
  console.error('Error running worker:', error);
  return Response.json(
    {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    },
    { status: 500 }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API endpoint to import from any GitHub URL
    if (url.pathname === '/api/github' && request.method === 'POST') {
      return handleGitHubImport(request);
    }

    // API endpoint to run workers
    if (url.pathname === '/api/run' && request.method === 'POST') {
      try {
        const { files, version, options } = (await request.json()) as {
          files: Record<string, string>;
          version: number;
          options?: {
            bundle?: boolean;
            minify?: boolean;
          };
        };

        // Bundle the worker with esbuild (dependencies are auto-installed from package.json)
        const { mainModule, modules, wranglerConfig, warnings } = await createWorker({
          files,
          bundle: options?.bundle ?? true,
          minify: options?.minify ?? false,
        });

        // Create the dynamic worker using the Worker Loader binding
        const worker = env.LOADER.get(`playground-worker-v${version}`, async () => ({
          mainModule,
          modules: modules as Record<string, string>,
          // Use wranglerConfig if available, otherwise use defaults
          compatibilityDate: wranglerConfig?.compatibilityDate ?? '2026-01-01',
          compatibilityFlags: wranglerConfig?.compatibilityFlags ?? [],
          env: {
            // Pass some example env vars
            API_KEY: 'sk-example-key-12345',
            DEBUG: 'true',
          },
          globalOutbound: null,
        }));

        // Execute and return response
        return executeWorker(worker, {
          mainModule,
          modules: Object.keys(modules),
          warnings: warnings ?? [],
        });
      } catch (error) {
        return buildErrorResponse(error);
      }
    }

    // Let assets handle everything else (serves index.html, CSS, JS)
    return env.ASSETS.fetch(request);
  },
};
