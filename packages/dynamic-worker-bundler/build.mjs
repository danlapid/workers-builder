import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

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
  external: ['esbuild-wasm', 'sucrase', 'resolve.exports', 'smol-toml'],
  plugins: [
    {
      name: 'wasm-external',
      setup(build) {
        // Rewrite the WASM import to be relative to output
        build.onResolve({ filter: /\.wasm$/ }, () => {
          return {
            path: './esbuild.wasm',
            external: true,
          };
        });
      },
    },
  ],
});
