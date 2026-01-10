import { createWorker } from 'dynamic-worker-bundler';

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
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
        const { files, version } = (await request.json()) as {
          files: Record<string, string>;
          version: number;
        };

        const startTime = Date.now();

        // Bundle the worker with esbuild, fetching dependencies
        const { mainModule, modules, warnings } = await createWorker({
          files,
          bundle: true,
          fetchDependencies: true,
          strictBundling: true,
        });

        // Create and run the dynamic worker
        const worker = env.LOADER.get(`playground-worker-v${version}`, async () => ({
          mainModule,
          modules: modules as Record<string, string>,
          compatibilityDate: '2026-01-01',
          env: {
            // Pass some example env vars
            API_KEY: 'sk-example-key-12345',
            DEBUG: 'true',
          },
          globalOutbound: null,
        }));

        const entrypoint = worker.getEntrypoint();

        // Execute the worker with a test request
        const testRequest = new Request('https://example.com/', {
          method: 'GET',
        });

        const workerResponse = await entrypoint.fetch(testRequest);
        const responseBody = await workerResponse.text();
        const executionTime = Date.now() - startTime;

        // Get response headers
        const responseHeaders: Record<string, string> = {};
        workerResponse.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return new Response(
          JSON.stringify({
            bundleInfo: {
              mainModule,
              modules: Object.keys(modules),
              warnings,
            },
            response: {
              status: workerResponse.status,
              headers: responseHeaders,
              body: responseBody,
            },
            executionTime,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        console.error('Error running worker:', error);
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Let assets handle everything else (serves index.html, CSS, JS)
    return env.ASSETS.fetch(request);
  },
};

// Parse GitHub URL into owner, repo, branch, and path
// Supports formats like:
// - https://github.com/owner/repo
// - https://github.com/owner/repo/tree/branch
// - https://github.com/owner/repo/tree/branch/path/to/dir
function parseGitHubUrl(urlString: string): {
  owner: string;
  repo: string;
  branch: string;
  path: string;
} | null {
  try {
    const url = new URL(urlString);

    if (url.hostname !== 'github.com') {
      return null;
    }

    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length < 2) {
      return null;
    }

    const owner = parts[0];
    const repo = parts[1];

    // Default branch and path
    let branch = 'main';
    let path = '';

    // Check if URL includes /tree/branch/path
    if (parts.length > 2 && parts[2] === 'tree') {
      branch = parts[3] || 'main';
      path = parts.slice(4).join('/');
    }

    return { owner, repo, branch, path };
  } catch {
    return null;
  }
}

// Handler to import files from any GitHub URL
async function handleGitHubImport(request: Request): Promise<Response> {
  try {
    const { url: githubUrl } = (await request.json()) as { url: string };

    if (!githubUrl) {
      return new Response(JSON.stringify({ error: 'Missing URL parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const parsed = parseGitHubUrl(githubUrl);

    if (!parsed) {
      return new Response(
        JSON.stringify({
          error:
            'Invalid GitHub URL. Expected format: https://github.com/owner/repo/tree/branch/path',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const { owner, repo, branch, path } = parsed;

    // Fetch all files from the GitHub directory
    const files = await fetchGitHubDirectory(owner, repo, branch, path);

    if (Object.keys(files).length === 0) {
      return new Response(JSON.stringify({ error: 'No files found at the specified location' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        files,
        source: {
          owner,
          repo,
          branch,
          path,
          url: githubUrl,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to fetch from GitHub',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Recursively fetch all files from a GitHub directory
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
        'User-Agent': 'dynamic-worker-bundler-playground',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Repository or path not found: ${owner}/${repo}/${dirPath || '(root)'}`);
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const contents = (await response.json()) as GitHubContent | GitHubContent[];

    // Handle single file case (when URL points directly to a file)
    if (!Array.isArray(contents)) {
      if (contents.type === 'file' && contents.download_url) {
        const fileResponse = await fetch(contents.download_url);
        if (fileResponse.ok) {
          const content = await fileResponse.text();
          // Make path relative to basePath
          const relativePath = basePath ? contents.path.replace(`${basePath}/`, '') : contents.path;
          files[relativePath] = content;
        }
      }
      return;
    }

    // Process all items in parallel
    await Promise.all(
      contents.map(async (item) => {
        if (item.type === 'file' && item.download_url) {
          const fileResponse = await fetch(item.download_url);
          if (fileResponse.ok) {
            const content = await fileResponse.text();
            // Make path relative to basePath
            const relativePath = basePath ? item.path.replace(`${basePath}/`, '') : item.path;
            files[relativePath] = content;
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
