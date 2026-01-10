// State
let files = {};
let currentFile = null;
let workerVersion = 0;

// DOM elements
const editor = document.getElementById('editor');
const fileTabs = document.getElementById('fileTabs');
const addFileBtn = document.getElementById('addFileBtn');
const runBtn = document.getElementById('runBtn');
const formatBtn = document.getElementById('formatBtn');
const output = document.getElementById('output');
const status = document.getElementById('status');
const examples = document.getElementById('examples');
const addFileModal = document.getElementById('addFileModal');
const newFileName = document.getElementById('newFileName');
const cancelAddFile = document.getElementById('cancelAddFile');
const confirmAddFile = document.getElementById('confirmAddFile');
const importFromGitHubBtn = document.getElementById('importFromGitHub');
const githubModal = document.getElementById('githubModal');
const closeGithubModalBtn = document.getElementById('closeGithubModal');
const githubUrlInput = document.getElementById('githubUrl');
const cancelGithubBtn = document.getElementById('cancelGithub');
const confirmGithubBtn = document.getElementById('confirmGithub');

// Examples
const EXAMPLES = {
  simple: {
    'src/index.ts': `export default {
  fetch(request: Request): Response {
    return new Response('Hello from dynamic worker!');
  }
}`,
    'package.json': JSON.stringify({ name: 'simple-worker', main: 'src/index.ts' }, null, 2),
  },
  'multi-file': {
    'src/index.ts': `import { greet } from './utils';
import { formatDate } from './helpers/date';

export default {
  fetch(request: Request): Response {
    const message = greet('World');
    const time = formatDate(new Date());
    return new Response(\`\${message}\\nTime: \${time}\`);
  }
}`,
    'src/utils.ts': `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}`,
    'src/helpers/date.ts': `export function formatDate(date: Date): string {
  return date.toISOString();
}`,
    'package.json': JSON.stringify({ name: 'multi-file-worker', main: 'src/index.ts' }, null, 2),
  },
  'json-config': {
    'src/index.ts': `import config from './config.json';

export default {
  fetch(request: Request): Response {
    return new Response(JSON.stringify({
      app: config.name,
      version: config.version,
      features: config.features
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}`,
    'src/config.json': JSON.stringify(
      {
        name: 'My App',
        version: '1.0.0',
        features: ['auth', 'api', 'webhooks'],
      },
      null,
      2
    ),
    'package.json': JSON.stringify({ name: 'config-worker', main: 'src/index.ts' }, null, 2),
  },
  'with-env': {
    'src/index.ts': `interface Env {
  API_KEY: string;
  DEBUG: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    const data = {
      hasApiKey: !!env.API_KEY,
      apiKeyPreview: env.API_KEY ? env.API_KEY.slice(0, 4) + '...' : null,
      debugMode: env.DEBUG === 'true'
    };
    
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}`,
    'package.json': JSON.stringify({ name: 'env-worker', main: 'src/index.ts' }, null, 2),
  },
  'api-router': {
    'src/index.ts': `import { handleUsers } from './routes/users';
import { handleHealth } from './routes/health';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return handleHealth();
    }
    
    if (url.pathname.startsWith('/users')) {
      return handleUsers(request);
    }
    
    return new Response(JSON.stringify({
      error: 'Not Found',
      availableRoutes: ['/health', '/users']
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}`,
    'src/routes/users.ts': `const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

export function handleUsers(request: Request): Response {
  return new Response(JSON.stringify({ users }), {
    headers: { 'Content-Type': 'application/json' }
  });
}`,
    'src/routes/health.ts': `export function handleHealth(): Response {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}`,
    'package.json': JSON.stringify({ name: 'api-router', main: 'src/index.ts' }, null, 2),
  },
};

// Initialize with simple example
loadExample('simple');

// Event listeners
examples.addEventListener('change', (e) => {
  if (e.target.value) {
    loadExample(e.target.value);
    e.target.value = '';
  }
});

editor.addEventListener('input', () => {
  if (currentFile) {
    files[currentFile] = editor.value;
  }
});

// Tab key support in editor
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = `${editor.value.substring(0, start)}  ${editor.value.substring(end)}`;
    editor.selectionStart = editor.selectionEnd = start + 2;
    if (currentFile) {
      files[currentFile] = editor.value;
    }
  }
});

addFileBtn.addEventListener('click', () => {
  addFileModal.classList.remove('hidden');
  newFileName.value = '';
  newFileName.focus();
});

cancelAddFile.addEventListener('click', () => {
  addFileModal.classList.add('hidden');
});

confirmAddFile.addEventListener('click', addNewFile);
newFileName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addNewFile();
  if (e.key === 'Escape') addFileModal.classList.add('hidden');
});

runBtn.addEventListener('click', runWorker);
formatBtn.addEventListener('click', formatCode);

// GitHub import modal events
importFromGitHubBtn.addEventListener('click', openGithubModal);
closeGithubModalBtn.addEventListener('click', closeGithubModal);
cancelGithubBtn.addEventListener('click', closeGithubModal);
confirmGithubBtn.addEventListener('click', importFromGitHub);
githubModal.addEventListener('click', (e) => {
  if (e.target === githubModal) closeGithubModal();
});
githubUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') importFromGitHub();
  if (e.key === 'Escape') closeGithubModal();
});

// Example link buttons
document.querySelectorAll('.example-link').forEach((btn) => {
  btn.addEventListener('click', () => {
    githubUrlInput.value = btn.dataset.url;
  });
});

function loadExample(name) {
  files = { ...EXAMPLES[name] };
  renderTabs();
  const firstFile = Object.keys(files)[0];
  selectFile(firstFile);
}

function renderTabs() {
  // Clear existing tabs except the add button
  const addBtn = fileTabs.querySelector('.add-file-btn');
  fileTabs.innerHTML = '';

  Object.keys(files).forEach((filename) => {
    const tab = document.createElement('button');
    tab.className = `file-tab${filename === currentFile ? ' active' : ''}`;
    tab.innerHTML =
      filename +
      (filename !== 'package.json'
        ? `<span class="close" data-file="${filename}">&times;</span>`
        : '');
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('close')) {
        deleteFile(e.target.dataset.file);
      } else {
        selectFile(filename);
      }
    });
    fileTabs.appendChild(tab);
  });

  fileTabs.appendChild(addBtn);
}

function selectFile(filename) {
  currentFile = filename;
  editor.value = files[filename] || '';
  renderTabs();
}

function addNewFile() {
  const filename = newFileName.value.trim();
  if (!filename) return;

  if (files[filename]) {
    alert('File already exists');
    return;
  }

  files[filename] = filename.endsWith('.json') ? '{}' : `// ${filename}\n`;
  addFileModal.classList.add('hidden');
  renderTabs();
  selectFile(filename);
}

function deleteFile(filename) {
  if (Object.keys(files).length <= 1) {
    alert('Cannot delete the last file');
    return;
  }

  delete files[filename];
  if (currentFile === filename) {
    currentFile = Object.keys(files)[0];
  }
  renderTabs();
  selectFile(currentFile);
}

function formatCode() {
  // Simple formatting - just re-indent
  try {
    if (currentFile?.endsWith('.json')) {
      const parsed = JSON.parse(editor.value);
      editor.value = JSON.stringify(parsed, null, 2);
      files[currentFile] = editor.value;
    }
  } catch (_e) {
    // Ignore formatting errors
  }
}

async function runWorker() {
  setStatus('loading', 'Bundling...');
  runBtn.disabled = true;

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files,
        version: ++workerVersion,
      }),
    });

    const result = await response.json();

    if (result.error) {
      setStatus('error', 'Bundle Error');
      showError(result.error, result.stack);
    } else if (result.workerError) {
      setStatus('error', 'Runtime Error');
      showResult(result);
    } else {
      setStatus('success', 'Success');
      showResult(result);
    }
  } catch (error) {
    setStatus('error', 'Error');
    showError(error.message);
  } finally {
    runBtn.disabled = false;
  }
}

function setStatus(type, text) {
  const dot = status.querySelector('.status-dot');
  const span = status.querySelector('span:last-child');
  dot.className = `status-dot ${type}`;
  span.textContent = text;
}

function showError(message, stack) {
  output.innerHTML = `
    <div class="output-section">
      <div class="output-label">Error</div>
      <div class="output-content error">${escapeHtml(message)}</div>
      ${stack ? `<div class="output-content error" style="margin-top: 12px; opacity: 0.7">${escapeHtml(stack)}</div>` : ''}
    </div>
  `;
}

function showResult(result) {
  const { bundleInfo, response, workerError, executionTime } = result;

  let responseBody = response.body;
  try {
    responseBody = JSON.stringify(JSON.parse(response.body), null, 2);
  } catch {}

  // Build the response section - show error if worker threw, otherwise show response
  let responseSection;
  if (workerError) {
    responseSection = `
      <div class="output-section">
        <div class="output-label">Worker Error</div>
        <div class="output-content error">${escapeHtml(workerError.message)}</div>
        ${workerError.stack ? `<div class="output-content error" style="margin-top: 12px; opacity: 0.7">${escapeHtml(workerError.stack)}</div>` : ''}
      </div>
    `;
  } else {
    responseSection = `
      <div class="output-section">
        <div class="output-label">Response (${response.status})</div>
        <div class="response-preview">
          <div class="response-headers">Content-Type: ${response.headers['content-type'] || 'text/plain'}</div>
          <div class="output-content success">${escapeHtml(responseBody)}</div>
        </div>
      </div>
    `;
  }

  output.innerHTML = `
    ${responseSection}
    
    <div class="output-section">
      <div class="output-label">Bundle Info</div>
      <div class="output-content">
        <strong>Main Module:</strong> ${bundleInfo.mainModule}
        <br><strong>Execution Time:</strong> ${executionTime}ms
      </div>
      <div style="margin-top: 12px">
        <div class="output-label">Modules (${bundleInfo.modules.length})</div>
        <div class="modules-list">
          ${bundleInfo.modules.map((m) => `<span class="module-badge">${m}</span>`).join('')}
        </div>
      </div>
      ${
        bundleInfo.warnings?.length
          ? `
        <div style="margin-top: 12px">
          <div class="output-label">Warnings</div>
          <div class="output-content warning">${bundleInfo.warnings.join('\n')}</div>
        </div>
      `
          : ''
      }
    </div>
  `;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// GitHub Import functionality
function openGithubModal() {
  githubModal.classList.remove('hidden');
  githubUrlInput.value = '';
  githubUrlInput.focus();
  setButtonLoading(false);
}

function closeGithubModal() {
  githubModal.classList.add('hidden');
  setButtonLoading(false);
}

function setButtonLoading(loading) {
  const btnText = confirmGithubBtn.querySelector('.btn-text');
  const btnLoading = confirmGithubBtn.querySelector('.btn-loading');

  if (loading) {
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
    confirmGithubBtn.disabled = true;
    githubUrlInput.disabled = true;
  } else {
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
    confirmGithubBtn.disabled = false;
    githubUrlInput.disabled = false;
  }
}

async function importFromGitHub() {
  const url = githubUrlInput.value.trim();

  if (!url) {
    alert('Please enter a GitHub URL');
    return;
  }

  if (!url.startsWith('https://github.com/')) {
    alert('Please enter a valid GitHub URL (https://github.com/...)');
    return;
  }

  setButtonLoading(true);
  setStatus('loading', 'Importing from GitHub...');

  try {
    const response = await fetch('/api/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Load the imported files
    files = data.files;

    // Ensure we have a package.json with the correct main entry
    if (!files['package.json']) {
      const mainFile =
        Object.keys(files).find(
          (f) =>
            f === 'src/index.ts' || f === 'src/index.js' || f === 'index.ts' || f === 'index.js'
        ) || Object.keys(files).find((f) => f.endsWith('.ts') || f.endsWith('.js'));

      if (mainFile) {
        files['package.json'] = JSON.stringify(
          { name: 'imported-worker', main: mainFile },
          null,
          2
        );
      }
    }

    renderTabs();
    const firstFile =
      Object.keys(files).find((f) => f.endsWith('.ts') || f.endsWith('.js')) ||
      Object.keys(files)[0];
    selectFile(firstFile);

    closeGithubModal();

    const fileCount = Object.keys(files).length;
    setStatus('success', `Imported ${fileCount} file${fileCount !== 1 ? 's' : ''}`);
  } catch (error) {
    setStatus('error', 'Import failed');
    alert(`Failed to import: ${error.message}`);
    setButtonLoading(false);
  }
}
