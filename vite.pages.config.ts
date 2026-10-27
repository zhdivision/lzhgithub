import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: process.env.PAGES_BASE_PATH || './',
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: { outDir: 'dist-pages', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5174 },
});
