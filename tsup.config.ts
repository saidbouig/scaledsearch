import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  clean: true,
  dts: false,
  sourcemap: true,
  noExternal: ['chalk'],
});
