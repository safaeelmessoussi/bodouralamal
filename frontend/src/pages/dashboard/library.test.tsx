import { describe, expect, it } from 'vitest';

import PAGE from './library.tsx?raw';

/**
 * **`عرض المحتوى` opens the exact item, not the bare shelf** (Owner request,
 * 2026-09-10).
 *
 * ## Why a source guard
 *
 * The button used to land on `/resources?level=<id>` — the Level's whole
 * shelf, with the item she chose nowhere marked. `resources.tsx`'s own
 * `LevelView` already reads a SECOND parameter, `?content=<id>`, to open
 * `ContentPreviewDialog` on arrival (the identical mechanism
 * `EventDetailsDialog`'s own materials links already use) — this page's own
 * data loads asynchronously (`fetchStudentIdentity`/`fetchLevelContent`), so
 * a static render shows only the loading state and never the row this fix
 * touches; the source is what actually states the link, both parameters and
 * the item id feeding it.
 */
const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the library table\'s open link deep-links to the exact item', () => {
  it('carries `?content=<id>` — the SAME parameter resources.tsx already reads to open the preview dialog', () => {
    expect(source).toMatch(/href=\{`\/resources\?level=\$\{levelId\}&content=\$\{i\.id\}`\}/);
  });

  it('keeps `?level=` alongside it, so a stale or unauthorized id still lands on her own Level\'s shelf', () => {
    expect(source).toContain('level=${levelId}');
  });

  it('reads the id from the ROW the link renders for, not a page-level or stale value', () => {
    // The cell function must take the row so each link points at its OWN
    // item — a shared/hoisted id would send every row to the same content.
    expect(source).toMatch(/cell:\s*\(i: ContentItem\)\s*=>/);
  });
});
