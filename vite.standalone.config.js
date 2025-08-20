import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rename } from 'fs/promises'
import { join } from 'path'

export default defineConfig({
  root: 'src/ui',
  plugins: [
    viteSingleFile({
      removeViteModuleLoader: true
    }),
    {
      name: 'rename-html',
      async writeBundle() {
        await rename(
          join('dist', 'index.html'),
          join('dist', 'index-standalone.html')
        )
      }
    }
  ],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
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