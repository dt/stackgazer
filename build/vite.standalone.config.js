import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rename } from 'fs/promises'
import { join } from 'path'
import cssnano from 'cssnano'

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
  define: {
    __ZIP_EXTERNAL__: false, // bundled build
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: 'src/ui/index.html',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'standalone-bundle.js',
        assetFileNames: 'standalone-bundle.css'
      }
    }
  },
  css: {
    postcss: {
      plugins: [
        cssnano({
          preset: 'default'
        })
      ]
    }
  },
  resolve: {
    alias: {
      'jszip': 'jszip'
    }
  }
})