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
      output: {
        // Create standalone bundle
        inlineDynamicImports: true,
        entryFileNames: 'index-standalone.js',
        assetFileNames: 'assets/[name].[ext]'
      }
    },
    // Inline small assets automatically
    assetsInlineLimit: 4096
  },
  resolve: {
    alias: {
      // Use jszip from node_modules
      'jszip': 'jszip'
    }
  }
})