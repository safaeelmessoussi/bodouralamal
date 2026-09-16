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
