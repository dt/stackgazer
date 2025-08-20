import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rename, unlink } from 'fs/promises'
import { join } from 'path'
import cssnano from 'cssnano'

export default defineConfig({
  root: 'src/ui',
  plugins: [
    viteSingleFile({
      removeViteModuleLoader: true
    }),
    {
      name: 'rename-and-cleanup',
      async writeBundle() {
        // Rename the HTML file
        await rename(
          join('dist', 'index.html'),
          join('dist', 'index-lite.html')
        )
        
        // Clean up intermediate files
        try {
          await unlink(join('dist', 'lite-bundle.js'))
          await unlink(join('dist', 'lite-bundle.css'))
        } catch (error) {
          // Files might not exist or already be cleaned up
        }
      }
    }
  ],
  build: {
    outDir: '../../dist',
    emptyOutDir: true, // Always nuke dist to ensure no stale files
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      mangle: {
        toplevel: true,
        properties: {
          regex: /^_|^[a-zA-Z]/,  // mangle properties starting with _ or any letter
          reserved: ['constructor', 'prototype', 'toString', 'valueOf']
        },
        reserved: ['require', 'exports', 'module']
      },
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.warn', 'console.error'],
        passes: 3
      },
      keep_classnames: false,
      keep_fnames: false
    },
    rollupOptions: {
      input: 'src/ui/index.html',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'lite-bundle.js',
        assetFileNames: 'lite-bundle.css'
      },
      external: ['jszip'], // Exclude JSZip from bundle
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
      // Don't resolve jszip
    }
  }
})