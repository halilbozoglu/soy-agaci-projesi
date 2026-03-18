import { defineConfig } from 'vite';

export default defineConfig({
  base: '/soy-agaci-projesi/',
  build: {
    minify: false,
    rollupOptions: {
      treeshake: false
    }
  },
  optimizeDeps: {
    include: ['d3-dag']
  }
});
