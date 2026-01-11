import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { createWorker } from 'workers-builder';
import { handleGitHubImport } from './github.js';
import { exports } from 'cloudflare:workers';

// Log entry from a tail event
interface LogEntry {
  level: string;
  message: string;
  timestamp: number;
}

// Durable Object that stores logs for a specific worker
export class LogSession extends DurableObject {
  private logs: LogEntry[] = [];
  private waiter: { resolve: (logs: LogEntry[]) => void; since: number } | null = null;

  // Called by the tail worker to add logs
  async addLogs(logs: LogEntry[]) {
    this.logs.push(...logs);

    // If someone is waiting for logs and we have logs since their subscription time, resolve
    if (this.waiter) {
      const logsSinceSubscription = this.logs.filter((log) => log.timestamp >= this.waiter!.since);
      if (logsSinceSubscription.length > 0) {
        this.waiter.resolve(logsSinceSubscription);
        this.waiter = null;
      }
    }

    // Limit log buffer size to prevent unbounded growth
    const maxLogs = 1000;
    if (this.logs.length > maxLogs) {
      this.logs = this.logs.slice(-maxLogs);
    }
  }

  // Called by the main handler to subscribe for logs
  // Returns the subscription timestamp to use with getLogs
  async subscribe(): Promise<number> {
    return Date.now();
  }

  // Called by the main handler to get logs since subscription time
  // Waits up to timeoutMs for logs to arrive
  async getLogs(since: number, timeoutMs: number = 1000): Promise<LogEntry[]> {
    // Check if we already have logs since the subscription time
    const existing = this.logs.filter((log) => log.timestamp >= since);
    if (existing.length > 0) {
      return existing;
    }

    // Wait for logs to arrive
    return new Promise<LogEntry[]>((resolve) => {
      const timeout = setTimeout(() => {
        this.waiter = null;
        resolve([]);
      }, timeoutMs);

      this.waiter = {
        since,
        resolve: (logs) => {
          clearTimeout(timeout);
          resolve(logs);
        },
      };
    });
  }
}

interface LogTailerProps {
  workerName: string;
}

// Tail worker entrypoint that receives logs and sends them to the DO
export class LogTailer extends WorkerEntrypoint<never, LogTailerProps> {
  override async tail(events: TraceItem[]) {
    const logSessionStub = exports.LogSession.getByName(this.ctx.props.workerName);

    for (const event of events) {
      const logs: LogEntry[] = event.logs.map((log: TraceLog) => ({
        level: log.level,
        message: Array.isArray(log.message)
          ? log.message
              .map((m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m)))
              .join(' ')
          : typeof log.message === 'string'
            ? log.message
            : JSON.stringify(log.message),
        timestamp: log.timestamp,
      }));

      if (logs.length > 0) {
        await logSessionStub.addLogs(logs);
      }
    }
  }
}

interface BundleInfo {
  mainModule: string;
  modules: string[];
  warnings: string[];
}

interface WorkerState {
  bundleInfo: BundleInfo | null;
  buildTime: number;
}

// Execute a dynamic worker and return the full response
async function executeWorker(
  worker: WorkerStub,
  state: WorkerState,
  workerName: string
): Promise<Response> {
  // Measure load time by calling a non-existent method
  // This triggers the cold start (build + load) but fails fast
  const entrypoint = worker.getEntrypoint() as Fetcher & { __warmup__: () => Promise<void> };
  const loadStart = Date.now();
  try {
    await entrypoint.__warmup__();
  } catch {
    // Expected to fail - method doesn't exist
  }
  const loadTime = Date.now() - loadStart;

  // After warmup, state.buildTime and state.bundleInfo are populated
  const { buildTime, bundleInfo } = state;

  // Subscribe to logs AFTER warmup so we don't get warmup logs
  const logSessionStub = exports.LogSession.getByName(workerName);
  const subscriptionTime = await logSessionStub.subscribe();

  // Now measure actual execution time
  const runStart = Date.now();
  const testRequest = new Request('https://example.com/', { method: 'GET' });

  let workerResponse: Response;
  let responseBody: string;
  let workerError: { message: string; stack?: string } | null = null;

  try {
    workerResponse = await entrypoint.fetch(testRequest);
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

  const runTime = Date.now() - runStart;

  // Fetch logs from the Durable Object (wait up to 1 second for tail event)
  const logs = await logSessionStub.getLogs(subscriptionTime, 1000);

  // Get response headers
  const responseHeaders: Record<string, string> = {};
  workerResponse.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return Response.json({
    bundleInfo: bundleInfo ?? { mainModule: '(cached)', modules: [], warnings: [] },
    response: {
      status: workerResponse.status,
      headers: responseHeaders,
      body: responseBody,
    },
    workerError,
    logs,
    timing: {
      buildTime,
      loadTime,
      runTime,
    },
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

        // Worker name is used for both the worker loader and the log session DO
        const workerName = `playground-worker-v${version}`;

        // Track bundle info and timing for the response
        const state: WorkerState = {
          bundleInfo: null,
          buildTime: 0,
        };

        // Create the dynamic worker using the Worker Loader binding
        // The async callback is only invoked if the worker isn't already warm
        const worker = env.LOADER.get(workerName, async () => {
          // Bundle the worker with esbuild (dependencies are auto-installed from package.json)
          const buildStart = Date.now();
          const { mainModule, modules, wranglerConfig, warnings } = await createWorker({
            files,
            bundle: options?.bundle ?? true,
            minify: options?.minify ?? false,
          });
          state.buildTime = Date.now() - buildStart;

          state.bundleInfo = {
            mainModule,
            modules: Object.keys(modules),
            warnings: warnings ?? [],
          };

          return {
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
            // Tail worker is global per worker - it sends logs to the LogSession DO
            tails: [
              exports.LogTailer({
                props: { workerName },
              }),
            ],
          };
        });

        // Execute and return response
        return executeWorker(worker, state, workerName);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }

    // Let assets handle everything else (serves index.html, CSS, JS)
    return env.ASSETS.fetch(request);
  },
};
