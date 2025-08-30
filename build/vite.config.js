import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/ui',
  base: './', // Use relative paths
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: 'src/ui/index.html',
    },
    // Inline small assets automatically
    assetsInlineLimit: 4096
  }
})