/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// One Cloudflare Pages project, one multi-page Vite build.
// `npm run dev:https` adds a self-signed cert so phone cameras work over the LAN.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        warehouse: resolve(root, 'warehouse/index.html'),
        demoLabels: resolve(root, 'warehouse/demo-labels.html'),
        employee: resolve(root, 'employee/index.html'),
        map: resolve(root, 'map/index.html'),
      },
    },
  },
  server: { host: mode === 'https' ? true : undefined },
  preview: { port: 4173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
}));
