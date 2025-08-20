import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  root: 'src/ui',
  plugins: [
    viteSingleFile({
      removeViteModuleLoader: true
    }),
    // Custom plugin to rename output file
    {
      name: 'rename-output',
      generateBundle(options, bundle) {
        // Find the HTML file and rename it
        const htmlFile = Object.keys(bundle).find(name => name.endsWith('.html'))
        if (htmlFile && htmlFile !== 'index-standalone.html') {
          bundle['index-standalone.html'] = bundle[htmlFile]
          delete bundle[htmlFile]
        }
      }
    }
  ],
  build: {
    outDir: '../../dist',
    emptyOutDir: true, // Clear dist for clean bundle-only output
    sourcemap: true,
    rollupOptions: {
      input: 'src/ui/index.html',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'standalone-bundle.js',
        assetFileNames: 'standalone-bundle.css'
      }
    }
  },
  resolve: {
    alias: {
      'jszip': 'jszip'
    }
  }
})