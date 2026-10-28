import { describe, expect, it } from 'vitest';

import PAGE from './library.tsx?raw';

/**
 * **`عرض المحتوى` opens the exact item, not the bare shelf** (Owner request,
 * 2026-09-10).
 *
 * ## Why a source guard
 *
 * The button used to land on `/resources?level=<id>` — the Level's whole
 * shelf, with the item she chose nowhere marked. `resources.tsx` reads
 * `?content=<id>` and opens `ContentPreviewDialog` where the item is read —
 * its Surah's page, else the library (R255; the identical link
 * `EventDetailsDialog`'s materials use) — this page's own
 * data loads asynchronously (`fetchStudentIdentity`/`fetchLevelContent`), so
 * a static render shows only the loading state and never the row this fix
 * touches; the source is what actually states the link, both parameters and
 * the item id feeding it.
 */
const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the library table\'s open link deep-links to the exact item', () => {
  it('carries `?content=<id>` — resources.tsx opens it where it is read (R255: its Surah page, else the library)', () => {
    expect(source).toMatch(/href=\{`\/resources\?content=\$\{i\.id\}`\}/);
  });

  it('reads the id from the ROW the link renders for, not a page-level or stale value', () => {
    // The cell function must take the row so each link points at its OWN
    // item — a shared/hoisted id would send every row to the same content.
    expect(source).toMatch(/cell:\s*\(i: ContentItem\)\s*=>/);
  });
});
