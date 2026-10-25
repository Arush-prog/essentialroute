// Shared esbuild configuration for dev and production builds.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outdir = path.join(root, 'dist');

export function esbuildOptions({ dev }) {
  return {
    absWorkingDir: root,
    entryPoints: { app: 'src/main.tsx' },
    bundle: true,
    outdir: path.join(outdir, 'assets'),
    entryNames: dev ? '[name]' : '[name]-[hash]',
    assetNames: '[name]-[hash]',
    format: 'esm',
    splitting: true,
    chunkNames: 'chunk-[hash]',
    target: ['es2020', 'chrome90', 'firefox90', 'safari14.1', 'ios14.5'],
    jsx: 'automatic',
    loader: { '.png': 'file', '.svg': 'file' },
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    metafile: true,
    define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'), __DEV__: String(dev) },
    logLevel: 'info',
  };
}

export async function prepareOutdir() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await cp(path.join(root, 'public'), outdir, { recursive: true });
}

/** Write dist/index.html with the hashed JS/CSS entry names taken from the esbuild metafile. */
export async function writeHtml(metafile, { dev }) {
  let js = 'assets/app.js';
  let css = 'assets/app.css';
  for (const [file, info] of Object.entries(metafile.outputs)) {
    if (info.entryPoint === 'src/main.tsx' && file.endsWith('.js')) {
      js = path.relative(outdir, path.join(root, file)).split(path.sep).join('/');
      if (info.cssBundle) css = path.relative(outdir, path.join(root, info.cssBundle)).split(path.sep).join('/');
    }
  }
  const tpl = await readFile(path.join(root, 'index.html'), 'utf8');
  const reload = dev
    ? `<script>new EventSource('/esbuild').addEventListener('change', () => location.reload());</script>`
    : '';
  const html = tpl
    .replace('<!--CSS-->', `<link rel="stylesheet" href="/${css}">`)
    .replace('<!--JS-->', `<script type="module" src="/${js}"></script>${reload}`);
  await writeFile(path.join(outdir, 'index.html'), html);
}
