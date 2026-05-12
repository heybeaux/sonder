import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
  },
  {
    // CLI entrypoints — CJS only (Node shebang scripts are most reliable as
    // CJS across pnpm bin shims) with a #! line prepended.
    entry: { 'cli/verify-chain': 'src/cli/verify-chain.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
