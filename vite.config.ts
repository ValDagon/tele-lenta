import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
