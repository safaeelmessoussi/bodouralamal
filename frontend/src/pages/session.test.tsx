import { describe, expect, it } from 'vitest';

import SESSION from './session.tsx?raw';
import RESOURCES from './resources.tsx?raw';

/** Comments are not code — the idiom the scheduling parity guard established. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

import type { SessionContentRef, SessionPage } from '../adapters/calendar.js';
import { resolveRoute } from '../lib/route.js';

/**
 * The §5.2 Session page.
 *
 * Two things are worth pinning: that the public route resolves at all — a
 * parameterised path the literal switch cannot express — and the contract the
 * page renders, since `api<T>()` is an unchecked cast and a renamed field would
 * otherwise surface only in a browser.
 */
const CONTENT: SessionContentRef = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'تسجيل الحصة',
  subject_id: '00000000-0000-4000-8000-000000000002',
  level_id: '00000000-0000-4000-8000-000000000003',
};

describe('the public route resolves', () => {
  it('matches a session path and nothing that merely looks like one', () => {
    expect(resolveRoute('/calendar/sessions/abc-123')).toBe('session');
    // The grid itself, and a path with a trailing segment, are different pages.
    expect(resolveRoute('/calendar')).toBe('calendar');
    expect(resolveRoute('/calendar/sessions')).toBe('not-found');
    expect(resolveRoute('/calendar/sessions/abc/extra')).toBe('not-found');
  });
});

describe('the page contract', () => {
  it('an attached item carries exactly what opening it in the Library needs', () => {
    // Deliberately NOT the object location: only GET /content/{id}/download-url
    // hands that out, after its own §4.9 check. A storage key on a public page
    // would be the one input that check exists to protect.
    expect(Object.keys(CONTENT).sort()).toEqual(['id', 'level_id', 'subject_id', 'title']);
    for (const leak of ['storage_key', 'storage_bucket', 'mime_type', 'url']) {
      expect(CONTENT).not.toHaveProperty(leak);
    }
  });

  it('keeps recordings and materials as separate lists', () => {
    // The API separates them because a recording is an §4.9 recording resource,
    // which is what BR-2's consent gate acts on. Merging them in the client
    // would discard the distinction that makes the gate legible.
    const page: Pick<SessionPage, 'recordings' | 'linked_content' | 'notes'> = {
      notes: null,
      recordings: [CONTENT],
      linked_content: [],
    };
    expect(page.recordings).not.toBe(page.linked_content);
    expect(page.recordings.some((r) => page.linked_content.includes(r))).toBe(false);
  });

  it('notes is nullable, and that is the specified state today', () => {
    // TD-3.4 names the field; §7 defines no storage for it. The page renders the
    // section only when present, so an empty "Notes" heading never implies
    // someone forgot to write any.
    const page: Pick<SessionPage, 'notes'> = { notes: null };
    expect(page.notes).toBeNull();
  });
});

/**
 * **A deep link must be consumed by the page it points at.**
 *
 * The session page linked its materials to `/resources?content_id={id}` and
 * **nothing anywhere read that parameter**: the library routes on `?level=`, so
 * the link landed on the Category index with the item neither opened nor even on
 * the page. It compiled, it navigated, and it did nothing — which is why a dead
 * parameter is worth a guard rather than a fix alone.
 *
 * Asserted as the pair: the link the session page emits, and the parameter the
 * library reads. Either one alone can drift.
 */
describe('a session’s materials open in the library', () => {
  it('links with BOTH halves — which shelf, and which item on it', () => {
    // `level` is what the library routes on; `content` is what it focuses. The
    // ref already carries `level_id`, so the link can name both.
    expect(code(SESSION)).toContain('/resources?level=${item.level_id}&content=${item.id}');
    // The dead parameter, asserted absent by name.
    expect(code(SESSION)).not.toContain('content_id=');
  });

  it('the library reads the parameter the link sends', () => {
    expect(code(RESOURCES)).toContain("get('content')");
    // Focus, never a gate (rule A): the shelf renders whether or not it is set,
    // so the read must not appear in a condition that guards the fetch.
    expect(code(RESOURCES)).not.toMatch(/if\s*\(!focusId\)\s*return/);
  });
});
