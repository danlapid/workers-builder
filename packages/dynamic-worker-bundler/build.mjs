import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure dist directory exists
mkdirSync(join(__dirname, 'dist'), { recursive: true });

// Find the esbuild.wasm file
function findWasmFile() {
  const possiblePaths = [
    join(__dirname, 'node_modules/esbuild-wasm/esbuild.wasm'),
    join(__dirname, '../../node_modules/esbuild-wasm/esbuild.wasm'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) return p;
  }

  // Try to find it using find command
  try {
    const found = execSync(
      'find ../../node_modules -name "esbuild.wasm" -type f 2>/dev/null | head -1',
      {
        cwd: __dirname,
        encoding: 'utf-8',
      }
    ).trim();
    if (found && existsSync(join(__dirname, found))) {
      return join(__dirname, found);
    }
  } catch {
    // Ignore
  }

  return null;
}

const wasmSource = findWasmFile();
if (!wasmSource) {
  console.error('Error: Could not find esbuild.wasm!');
  process.exit(1);
}

// Copy WASM file to dist/
const wasmDest = join(__dirname, 'dist/esbuild.wasm');
copyFileSync(wasmSource, wasmDest);
console.log(`Copied esbuild.wasm to dist/`);

// Build the library - keep the WASM import as external
// so it's resolved relative to the output file
await esbuild.build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  // Mark npm dependencies as external
  external: ['esbuild-wasm', 'sucrase', 'resolve.exports'],
  plugins: [
    {
      name: 'wasm-external',
      setup(build) {
        // Rewrite the WASM import to be relative to output
        build.onResolve({ filter: /\.wasm$/ }, (args) => {
          return {
            path: './esbuild.wasm',
            external: true,
          };
        });
      },
    },
  ],
});

console.log('Build complete!');
