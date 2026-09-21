import esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv[2] === 'production';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  format: 'cjs',
  target: 'es2021',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  minify: production,
  outfile: 'main.js'
});
