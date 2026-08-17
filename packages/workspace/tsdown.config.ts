import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', catalog: 'src/catalog.ts', sessions: 'src/sessions.ts' },
  outDir: 'lib', format: ['esm'], platform: 'neutral', target: 'es2022', dts: true, sourcemap: true, clean: true,
})
