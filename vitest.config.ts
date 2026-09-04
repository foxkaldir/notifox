import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { obsidian: fileURLToPath(new URL('./test/obsidian.ts', import.meta.url)) }
  },
  test: {
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } }
  }
});
