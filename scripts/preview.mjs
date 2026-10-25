// Serve the production build (dist/) locally.
import * as esbuild from 'esbuild';
import { outdir } from './shared.mjs';
const port = Number(process.env.PORT || 4173);
const ctx = await esbuild.context({ entryPoints: [] });
const { port: actual } = await ctx.serve({ servedir: outdir, port, host: '0.0.0.0', fallback: `${outdir}/index.html` });
console.log(`Serving dist/ → http://localhost:${actual}`);
