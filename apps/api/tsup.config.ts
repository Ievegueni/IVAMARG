import { defineConfig } from 'tsup';

// Empacota o @ivamarg/shared (TS fonte) dentro do build da API.
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: 'esm',
  target: 'node20',
  noExternal: ['@ivamarg/shared'],
  clean: true,
});
