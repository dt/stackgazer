import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rename } from 'fs/promises'
import { join } from 'path'

export default defineConfig({
  root: 'src/ui',
  plugins: [
    viteSingleFile({removeViteModuleLoader: true}),
  ],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/ui/index.html'
    },
  },
})