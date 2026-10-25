import * as esbuild from 'esbuild';
import { esbuildOptions, prepareOutdir, writeHtml } from './shared.mjs';

await prepareOutdir();
const result = await esbuild.build(esbuildOptions({ dev: false }));
await writeHtml(result.metafile, { dev: false });
console.log('\nBuild complete → dist/  (serve it over HTTPS for GPS on phones)');
