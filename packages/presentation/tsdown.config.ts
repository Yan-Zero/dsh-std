import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', operations: 'src/operations.ts', interaction: 'src/interaction.ts', callback: 'src/callback.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
})
