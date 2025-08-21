import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rename, unlink } from 'fs/promises'
import { join } from 'path'
import cssnano from 'cssnano'
import createHtmlPlugin from 'vite-plugin-html-minifier'

function injectJsZipCdn() {
  return {
    name: 'inject-jszip-cdn',
    transformIndexHtml() {
      const flag = {
        tag: 'script',
        children: 'window.__zipCdnFailed = false;',
        injectTo: 'head'
      };
      const jszip = {
        tag: 'script',
        attrs: {
          src: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
          defer: true,
          crossorigin: 'anonymous',
          onerror: 'window.__zipCdnFailed = true'
        },
        injectTo: 'head'
      };
      return { tags: [flag, jszip] };
    }
  };
}

export default defineConfig({
  root: 'src/ui',
  plugins: [
    injectJsZipCdn(),
    viteSingleFile({
      removeViteModuleLoader: true
    }),
    createHtmlPlugin({
      removeComments: true,
      collapseWhitespace: true,
      removeAttributeQuotes: true,
      minifyCSS: true,
      minifyJS: true
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
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      mangle: {
        toplevel: true,
        properties: {
          regex: /^_/,
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
      external: ['jszip'],
    }
  },
  optimizeDeps: {
    exclude: ['jszip']
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