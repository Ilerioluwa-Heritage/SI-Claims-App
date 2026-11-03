// The website: `npm run dev` to try it on this computer, `npm run build` to make
// the files that go online. Its code is in web/; the rules it uses are in src/.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  // Relative links, so the site works wherever it's put online (e.g. in a sub-folder).
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  // The PDF library alone is about 500 kB, so the page is bigger than Vite's usual warning size.
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
