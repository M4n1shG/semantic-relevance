import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'demo-src',
  base: './',
  build: {
    outDir: '../docs',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'demo-src/index.html')
    }
  },
  resolve: {
    alias: {
      'semantic-relevance': resolve(__dirname, 'src/index.js')
    }
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers']
  }
});
