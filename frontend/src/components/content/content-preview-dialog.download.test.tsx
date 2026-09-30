import { describe, expect, it } from 'vitest';

import SOURCE from './content-preview-dialog.tsx?raw';

/**
 * **«تنزيل الملف» actually downloads, rather than opening the file in a new
 * tab (Owner report, 2026-09-16).**
 *
 * The button used to call `window.open(load.url, ...)` — `load.url` is the
 * SAME presigned URL the preview surface renders inline with, minted with no
 * `Content-Disposition`, so a browser that can render the MIME type (a PDF,
 * an image) simply displayed it again instead of saving it.
 *
 * The fix mints a SEPARATE, `attachment`-disposed URL on click rather than
 * reusing `load.url` — this is a source-pinning test, not a render test,
 * because the dialog's data loads asynchronously (`fetchContentUrl` inside a
 * `useEffect`) and a static render only ever shows the loading state, same
 * reasoning as `dashboard/library.test.tsx`'s own deep-link guard.
 */
const source = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the download button mints its own attachment-disposed URL', () => {
  it('never reuses load.url for the download click', () => {
    expect(source).not.toMatch(/onClick=\{[^}]*window\.open\(load\.url/s);
  });

  it('fetches a fresh URL with disposition: attachment', () => {
    expect(source).toContain(
      "fetchContentUrl(item.id, accessToken, activeChildId, 'attachment')",
    );
  });

  it('disables the button while the fetch is in flight, so a slow network cannot be double-clicked', () => {
    expect(source).toContain('disabled={downloading}');
    expect(source).toContain('setDownloading(true)');
    expect(source).toContain('.finally(() => setDownloading(false))');
  });
});

/**
 * **R184 §6 (Owner report from a phone, 2026-09-30) — a browser with no inline
 * PDF viewer gets «فتح الملف», not a broken frame.** Android Chrome cannot
 * render a PDF inside an `<iframe>` and paints its broken-file icon there; it
 * says so through `navigator.pdfViewerEnabled === false`. A browser that does
 * not answer (Safari, `undefined`) keeps the frame — it renders inline.
 */
describe('a PDF on a device without an inline viewer opens in the device viewer', () => {
  it('asks the browser (`pdfViewerEnabled === false`), never the user agent string', () => {
    expect(source).toContain("navigator.pdfViewerEnabled === false");
    expect(source).not.toMatch(/userAgent|Android|iPhone/);
  });

  it('offers «فتح الملف» as a new top-level context and keeps the frame otherwise', () => {
    expect(source).toContain("window.open(url, '_blank', 'noopener,noreferrer')");
    expect(source).toContain("t('content.openFile')");
    expect(source).toContain('<iframe className="preview__pdf" src={url} title={item.title} />');
  });
});
