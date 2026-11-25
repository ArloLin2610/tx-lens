// Bundles a pipeline TypeScript entry with esbuild and runs it.
// Usage: npm run data:build   (or: node scripts/build-data.mjs scripts/pipeline/other.ts)
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(here, 'pipeline/build-data.ts');
const outDir = await mkdtemp(join(tmpdir(), 'tx-lens-data-'));
await build({ entryPoints: [entry], outfile: join(outDir, 'run.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' });
try {
  await import(pathToFileURL(join(outDir, 'run.mjs')).href);
} catch (error) {
  console.error('[data] pipeline failed:', error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
