import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/ui',
  build: {
    outDir: '../../dist',
    emptyOutDir: false, // Don't clear dist since we may have other files
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
      // Map jszip import to the bundled version
      'jszip': '/jszip.js'
    }
  }
})