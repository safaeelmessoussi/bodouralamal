import { useEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';

type Pdfjs = typeof import('pdfjs-dist');

let pdfjsReady: Promise<{ pdfjs: Pdfjs; worker: InstanceType<Pdfjs['PDFWorker']> }> | null = null;

/**
 * **R250 — pdf.js and its worker, loaded once and early.** Most of the wait
 * before a phone's first page was pdf.js itself (≈1.4 MB), fetched only after
 * the file's URL was minted. The dialog now starts it beside the mint, a page
 * that lists files starts it when idle (`warmPdfPreview`), and the one worker
 * is kept for every document afterwards.
 */
function loadPdfjs(): NonNullable<typeof pdfjsReady> {
  pdfjsReady ??= import('pdfjs-dist')
    .then((pdfjs) => {
      // Served beside the page as `.js` (see `vite.config.ts`): nginx types
      // `.mjs` as an octet stream under `nosniff`, which a worker refuses.
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
      return { pdfjs, worker: new pdfjs.PDFWorker() };
    })
    .catch((error: unknown) => {
      pdfjsReady = null;
      throw error;
    });
  return pdfjsReady;
}

/** Whether this browser draws PDFs through pdf.js (it has no viewer of its own). */
export function needsPdfCanvas(): boolean {
  return typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === false;
}

/**
 * R250 — start pdf.js now, where a PDF is likely to be opened next. Only where
 * it will be used, and never on a connection that asked to save data.
 */
export function warmPdfPreview(): void {
  if (!needsPdfCanvas()) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  void loadPdfjs().catch(() => undefined);
}

/**
 * **A PDF drawn in the page, where the browser cannot** (R190 §5). Android
 * Chrome has no inline PDF viewer: an `<iframe>` of the file shows a broken
 * icon, and R184 §6's «فتح الملف» left the reader outside the platform. This
 * renders the document itself onto canvases, at the container's width and the
 * screen's pixel density, with pdf.js bundled from this origin (§3.1's CSP
 * admits no external script, and the worker is ours).
 *
 * **R250 — each canvas is left-to-right.** A canvas inherits the document's
 * `direction`, and in this right-to-left page pdf.js's glyph-by-glyph drawing
 * came out with Arabic letters apart and missing; the text inside the PDF
 * still reads right to left. **And only the pages near the screen are fetched
 * and drawn** (`disableAutoFetch`, one observer): an 8 MB «كراسة» no longer
 * downloads whole before its first page.
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
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    let pdf: { destroy: () => Promise<void> } | null = null;
    let observer: IntersectionObserver | null = null;
    node.replaceChildren();
    setOpened(false);
    void (async () => {
      try {
        const { pdfjs, worker } = await loadPdfjs();
        const loaded = await pdfjs.getDocument({
          url,
          worker,
          disableAutoFetch: true,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
        }).promise;
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        pdf = loaded;
        const width = Math.max(240, node.clientWidth);
        const density = Math.min(window.devicePixelRatio || 1, 2);
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        // Every page holds its place at the first page's shape until drawn.
        const canvases = Array.from({ length: loaded.numPages }, (_, index) => {
          const canvas = window.document.createElement('canvas');
          canvas.className = 'preview__pdfPage';
          canvas.dir = 'ltr';
          canvas.style.width = `${width}px`;
          canvas.style.height = `${Math.ceil((first.height / first.width) * width)}px`;
          canvas.setAttribute('aria-label', `${title} — ${index + 1}/${loaded.numPages}`);
          node.appendChild(canvas);
          return canvas;
        });
        setOpened(true);
        const drawn = new Set<number>();
        const draw = async (number: number): Promise<void> => {
          if (drawn.has(number)) return;
          drawn.add(number);
          const page = await loaded.getPage(number);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * density });
          const canvas = canvases[number - 1]!;
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.height = `${Math.ceil(viewport.height / density)}px`;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          await page.render({ canvasContext: context, viewport, canvas }).promise;
        };
        await draw(1);
        const scroller = node.closest('.preview__pdfCanvas');
        observer = new IntersectionObserver(
          (seen) => {
            for (const entry of seen) {
              if (!entry.isIntersecting) continue;
              const number = canvases.indexOf(entry.target as HTMLCanvasElement) + 1;
              void draw(number).catch(() => {
                if (!cancelled) onError();
              });
            }
          },
          { root: scroller, rootMargin: '100% 0px' },
        );
        for (const canvas of canvases.slice(1)) observer.observe(canvas);
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      void pdf?.destroy();
    };
  }, [url, title, onError]);

  return (
    <div className="preview__pdfCanvas" role="document" aria-label={title}>
      <div className="preview__pdfPages" ref={host} />
      {opened ? null : (
        <div className="preview__pdfOpening" role="status">
          <span className="skeleton preview__pdfSkeleton" aria-hidden="true" />
          <p className="preview__pdfStatus">{t('content.previewPdfOpening')}</p>
        </div>
      )}
    </div>
  );
}

/** R250 — a page that lists PDFs starts pdf.js once it is idle (see `warmPdfPreview`). */
export function useWarmPdfPreview(listsPdf: boolean): void {
  useEffect(() => {
    if (!listsPdf) return;
    const idle = (window as Window & { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback;
    if (idle) idle(warmPdfPreview);
    else window.setTimeout(warmPdfPreview, 1500);
  }, [listsPdf]);
}
