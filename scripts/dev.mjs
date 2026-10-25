import * as esbuild from 'esbuild';
import { esbuildOptions, prepareOutdir, writeHtml, outdir } from './shared.mjs';

const port = Number(process.env.PORT || 5173);
await prepareOutdir();
const ctx = await esbuild.context({
  ...esbuildOptions({ dev: true }),
  plugins: [{
    name: 'html',
    setup(build) {
      build.onEnd(async (r) => { if (r.metafile) await writeHtml(r.metafile, { dev: true }); });
    },
  }],
});
await ctx.watch();
const { port: actual } = await ctx.serve({ servedir: outdir, port, host: '0.0.0.0', fallback: `${outdir}/index.html` });
console.log(`\nEssentialRoute dev server → http://localhost:${actual}`);
console.log('GPS needs a secure context: localhost works on this computer; phones need HTTPS (see README).');
