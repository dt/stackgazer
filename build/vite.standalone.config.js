import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  root: 'src/ui',
  plugins: [
    viteSingleFile({removeViteModuleLoader: true}),
  ],
  esbuild: {
    // Turn off template literals, so `\n` won't become a multiline backtick;
    // This keeps the whole inlined script on one line, making it easier to
    // see where to customize the actually boot params below it.
    supported: { 'template-literal': false },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    
    rollupOptions: {
      input: 'src/ui/index.html'
    },
  },
})