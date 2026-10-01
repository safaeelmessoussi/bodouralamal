import { useEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';

/**
 * **A PDF drawn in the page, where the browser cannot** (R190 §5). Android
 * Chrome has no inline PDF viewer: an `<iframe>` of the file shows a broken
 * icon, and R184 §6's «فتح الملف» left the reader outside the platform. This
 * renders the document itself — page after page onto canvases, at the
 * container's width and the screen's pixel density — with pdf.js, loaded on
 * demand (its own chunk, never on a laptop that has a viewer) and bundled
 * from this origin: §3.1's CSP admits no external script, and the worker is
 * ours.
 *
 * The URL is the same short-lived presigned one the frame would have shown,
 * on this origin through the storage proxy, so the permission path (§3.1,
 * TD-12) is unchanged. A failure (expired URL, a damaged file) is reported
 * through `onError`, which the dialog turns into its retry state.
 */
export function PdfCanvasPreview({
  url,
  title,
  onError,
}: {
  url: string;
  title: string;
  onError: () => void;
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    let document: { destroy: () => Promise<void> } | null = null;
    node.replaceChildren();
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Served beside the page as `.js` (see `vite.config.ts`): nginx types
        // `.mjs` as an octet stream under `nosniff`, which a worker refuses.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
        const loaded = await pdfjs.getDocument({
          url,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
        }).promise;
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        document = loaded;
        setPages({ done: 0, total: loaded.numPages });
        const width = Math.max(240, node.clientWidth);
        const density = Math.min(window.devicePixelRatio || 1, 2);
        for (let number = 1; number <= loaded.numPages; number += 1) {
          const page = await loaded.getPage(number);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * density });
          const canvas = window.document.createElement('canvas');
          canvas.className = 'preview__pdfPage';
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${width}px`;
          canvas.style.height = `${Math.ceil(viewport.height / density)}px`;
          canvas.setAttribute('aria-label', `${title} — ${number}/${loaded.numPages}`);
          node.appendChild(canvas);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          if (cancelled) return;
          setPages({ done: number, total: loaded.numPages });
        }
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
      void document?.destroy();
    };
  }, [url, title, onError]);

  return (
    <div className="preview__pdfCanvas" role="document" aria-label={title}>
      <div className="preview__pdfPages" ref={host} />
      {pages === null ? (
        <p className="preview__pdfStatus" role="status">
          {t('states.loading')}
        </p>
      ) : pages.done < pages.total ? (
        <p className="preview__pdfStatus" role="status">
          {t('content.previewPdfPages')
            .replace('{done}', String(pages.done))
            .replace('{total}', String(pages.total))}
        </p>
      ) : null}
    </div>
  );
}
