import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * **pdf.js's own data files beside the page** (R190 §5). The in-page PDF
 * renderer (`content/pdf-canvas-preview.tsx`, used where a browser has no
 * PDF viewer of its own — a phone) needs pdf.js's CMaps and standard fonts
 * for documents whose fonts are not embedded. §3.1's CSP admits no external
 * host, so they are served from `/pdfjs/` on this origin: copied from the
 * package into `dist/` at build time, served from the package in `vite dev`.
 * The worker goes there too, AS `.js`: nginx types `.mjs` as an octet stream
 * under `nosniff`, which a module worker refuses. Nothing is committed twice.
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  const folders = ['cmaps', 'standard_fonts'];
  return {
    name: 'bodour-pdfjs-assets',
    closeBundle() {
      for (const folder of folders) {
        const from = join(root, folder);
        if (existsSync(from)) cpSync(from, join('dist', 'pdfjs', folder), { recursive: true });
      }
      cpSync(join(root, 'build', 'pdf.worker.min.mjs'), join('dist', 'pdfjs', 'pdf.worker.min.js'));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/pdfjs/pdf.worker.min.js') {
          res.setHeader('Content-Type', 'text/javascript');
          require('node:fs').createReadStream(join(root, 'build', 'pdf.worker.min.mjs')).pipe(res);
          return;
        }
        const match = /^\/pdfjs\/(cmaps|standard_fonts)\/([^/?]+)$/.exec(url);
        if (!match) return next();
        const file = join(root, match[1]!, match[2]!);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        require('node:fs').createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
});
