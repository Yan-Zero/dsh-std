import type { UserConfig } from 'tsdown'

const clientExternals = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-tool/client',
] as const

export default [
  {
    entry: { index: 'src/index.ts', 'profile-loader': 'src/profile-loader.ts', 'client-api': 'src/client.ts' },
    outDir: 'lib', format: ['esm'], fixedExtension: false, platform: 'node', target: 'node22.19',
    dts: true, sourcemap: true, clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//, /^@dsh-std\//, /^node:/] },
  },
  {
    entry: { client: 'src/client.ts' },
    outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false,
    deps: { alwaysBundle: [/^@dsh-std\//], neverBundle: [...clientExternals] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@dsh-std/adapter-dsh", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      exports: 'named',
    },
  },
] satisfies UserConfig[]
