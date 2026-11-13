/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `base` is the public path the app is served from.
 * - GitHub Pages project site: '/<repo-name>/' (the default below).
 * - Vercel / any root-hosted deploy: set BASE_PATH=/ at build time.
 */
const REPO_NAME = 'petriDish';

function normaliseBase(raw: string | undefined): string {
  if (!raw) return `/${REPO_NAME}/`;
  let base = raw.startsWith('/') ? raw : `/${raw}`;
  if (!base.endsWith('/')) base += '/';
  return base;
}

export default defineConfig({
  base: normaliseBase(process.env.BASE_PATH),
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
