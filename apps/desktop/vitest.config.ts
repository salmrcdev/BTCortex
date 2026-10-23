import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'desktop',
    root: fileURLToPath(new URL('.', import.meta.url)),
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/testing/setup.ts'],
  },
});
