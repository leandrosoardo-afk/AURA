import { resolve } from 'path';
import type { Connect } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const reescribirLanding: Connect.NextHandleFunction = (req, _res, next) => {
  if (req.url === '/landing' || req.url === '/landing/') req.url = '/landing.html';
  next();
};

const proxy = { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 3101}`, xfwd: true } };
// Permite abrir la app desde el enlace temporal de Cloudflare para el grupo.
const allowedHosts = ['.trycloudflare.com'];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'reescribir-landing',
      configureServer: (server) => void server.middlewares.use(reescribirLanding),
      configurePreviewServer: (server) => void server.middlewares.use(reescribirLanding),
    },
  ],
  server: { port: 4173, strictPort: true, proxy, allowedHosts },
  preview: { port: 4173, strictPort: true, proxy, allowedHosts },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        landing: resolve(import.meta.dirname, 'landing.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
