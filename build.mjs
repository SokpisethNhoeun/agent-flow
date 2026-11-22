// Builds the worker (Node ESM) and the single UI bundle every surface loads.
import { build, context } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'

const watch = process.argv.includes('--watch')

const worker = {
  entryPoints: ['src/worker/main.ts'],
  outfile: 'dist/worker.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  external: ['orca', 'orca/*'],
  logLevel: 'info'
}

const ui = {
  entryPoints: { app: 'src/ui/main.tsx' },
  outdir: 'dist/ui',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  // The chat (assistant-ui + markdown) is about half the UI code; it loads when a chat opens.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: ['chrome120'],
  jsx: 'automatic',
  // AF_DEV_UI=1: readable React errors with component stacks (debugging a crash), not for release.
  minify: !watch && !process.env.AF_DEV_UI,
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch || process.env.AF_DEV_UI ? 'development' : 'production') },
  loader: { '.svg': 'file' },
  logLevel: 'info'
}

/** Runs dagre off the main thread; app.js starts it from this file next to itself. */
const layoutWorker = {
  entryPoints: { 'layout-worker': 'src/ui/graph/layout.worker.ts' },
  outdir: 'dist/ui',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  minify: !watch && !process.env.AF_DEV_UI,
  logLevel: 'info'
}

async function copyStatic() {
  await mkdir('dist/ui', { recursive: true })
  for (const file of ['panel.html', 'canvas.html', 'dashboard.html', 'icon.svg']) await cp(`ui/${file}`, `dist/ui/${file}`)
}

if (watch) {
  await copyStatic()
  const contexts = await Promise.all([context(worker), context(ui), context(layoutWorker)])
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log('watching…')
} else {
  await rm('dist', { recursive: true, force: true })
  await copyStatic()
  await Promise.all([build(worker), build(ui), build(layoutWorker)])
}
