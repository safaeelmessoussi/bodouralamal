import { describe, expect, it } from 'vitest';

import { ar } from './ar.js';
import { t, tList } from './index.js';

/**
 * **Every translation key the source asks for must exist.**
 *
 * ## The defect this exists for, and why it is architectural
 *
 * `t()` returns **its own argument** when a key is missing. That is a deliberate
 * choice — a raw key in the interface is loud, where a blank string would be
 * silent — but it means **a typo ships as user-facing text** and nothing fails.
 * `نقاط الامتحانات` rendered a table headed `admin.schedules.title`,
 * `admin.exams.date`, `admin.exams.audience` for exactly this reason, and the
 * same three keys had been wrong on `/teacher/exams` before that page was
 * rewritten — so the defect *propagated by being copied*, which is the shape a
 * missing guard always produces.
 *
 * It had happened before: `admin.nav.schedules` for `admin.nav.scheduling`,
 * caught by a guard that covers **only the module registry's labels**. This is
 * that guard generalised to every `t()` call in the application, which is where
 * it should have been.
 *
 * ## Why a source scan, and what it can and cannot see
 *
 * The property is *"no key in the source is absent from the catalogue"* — a
 * statement about the pair, invisible to any single rendered output. So the
 * literals are extracted from source and resolved against the real catalogue.
 *
 * **Computed keys are out of reach and that is stated rather than hidden.**
 * `t(\`admin.section.${section}\`)` and `t(\`roles.${r}\`)` are resolved by their
 * own registry guards, which enumerate the values the template can take —
 * `admin-modules.test.ts`, `teacher-modules.test.ts` and `coverage.test.ts` each
 * cover one family. What is asserted here is every **literal**, which is the
 * overwhelming majority and the whole of the class that has ever broken.
 */

const RAW = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Comments quote keys while explaining them; only code is scanned. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

interface Usage {
  file: string;
  key: string;
  fn: 't' | 'tList';
}

function usages(): Usage[] {
  const found: Usage[] = [];
  for (const [path, text] of Object.entries(RAW)) {
    // The catalogue itself, and this guard, name keys without calling them.
    if (path.endsWith('/i18n/ar.ts') || path.endsWith('/i18n/index.ts')) continue;
    // **Tests are excluded, and one of them is why.** `coverage.test.ts` calls
    // `t('scheduling.this.key.does.not.exist')` deliberately, to assert the
    // fallback this guard polices — correct code that a naive scan reads as the
    // defect. A test asserting a miss is not a screen rendering one.
    if (/\.test\.tsx?$/.test(path)) continue;
    const code = stripComments(text);
    for (const m of code.matchAll(/\b(t|tList)\((['"])([A-Za-z0-9_.]+)\2/g)) {
      found.push({ file: path.replace('/src/', ''), key: m[3]!, fn: m[1] as 't' | 'tList' });
    }
  }
  return found;
}

/**
 * **The computed keys' NAMESPACE, which is checkable even when the leaf is not**
 * (2026-08-19).
 *
 * This guard scanned quoted literals only, and said so: *"a template literal is
 * a computed key and belongs to a registry guard, not to this one."* Then
 * `t(`calendar.weekday.${'${'}d}`)` shipped — pointing at a namespace that does not
 * exist, because the weekday labels live under `scheduling.weekday`. Seven raw
 * keys rendered on screen, and every test passed.
 *
 * The leaf genuinely cannot be resolved here; **the prefix can**. A computed key
 * `a.b.${'${'}x}` requires `a.b` to be an OBJECT in the catalogue, and asserting that
 * would have caught this the moment it was written. It is the cheap half of the
 * registry guard that page still recommends, and it closes the class rather than
 * the instance.
 */
function computedPrefixes(): { file: string; prefix: string }[] {
  const found: { file: string; prefix: string }[] = [];
  for (const [path, text] of Object.entries(RAW)) {
    if (path.endsWith('/i18n/ar.ts') || path.endsWith('/i18n/index.ts')) continue;
    if (/\.test\.tsx?$/.test(path)) continue;
    const code = stripComments(text);
    // `t(`some.namespace.${'${'}expr}`)` — the literal head before the first hole.
    for (const m of code.matchAll(/\b(?:t|tList)\(`([A-Za-z0-9_.]+)\.\$\{/g)) {
      found.push({ file: path.replace('/src/', ''), prefix: m[1]! });
    }
  }
  return found;
}

const ALL = usages();
const COMPUTED = computedPrefixes();

describe('every COMPUTED key points at a namespace that exists', () => {
  it('finds computed keys at all — this guard exists because one escaped', () => {
    expect(COMPUTED.length).toBeGreaterThan(0);
  });

  it('resolves each prefix to an object in the catalogue', () => {
    const offenders = COMPUTED.filter(({ prefix }) => {
      const node = prefix
        .split('.')
        .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], ar);
      return typeof node !== 'object' || node === null;
    }).map(({ file, prefix }) => `${prefix}  (${file})`);
    expect(offenders).toEqual([]);
  });
});

describe('every literal translation key resolves', () => {
  it('finds keys to check at all — a scan that matches nothing proves nothing', () => {
    // The failure mode of the guard itself: a regex that stops matching would
    // pass silently and certify a broken catalogue.
    expect(ALL.length).toBeGreaterThan(300);
  });

  it('resolves every t() key to a real string, never back to the key', () => {
    const broken = ALL.filter((u) => u.fn === 't' && t(u.key) === u.key).map(
      (u) => `${u.key}  (${u.file})`,
    );
    // Listed with their files, because the remedy is per call site: the key may
    // be a typo, or the catalogue may genuinely be missing an entry.
    expect(broken).toEqual([]);
  });

  it('resolves every tList() key to a non-empty array', () => {
    // `tList` fails differently — it returns `[]`, which renders as *nothing*
    // rather than as a loud key, so a missing list is the quieter defect of the
    // two and the one more worth asserting.
    const broken = ALL.filter((u) => u.fn === 'tList' && tList(u.key).length === 0).map(
      (u) => `${u.key}  (${u.file})`,
    );
    expect(broken).toEqual([]);
  });
});

describe('a key never renders as user-facing text', () => {
  it('t() returns the key on a miss — the behaviour this guard exists to police', () => {
    // Asserted directly, so the guard documents *why* it is needed rather than
    // relying on a reader knowing. If this ever changes to throwing, or to
    // returning '', the reasoning above needs revisiting — and this assertion is
    // what will say so.
    expect(t('definitely.not.a.real.key')).toBe('definitely.not.a.real.key');
  });

  it('no catalogue VALUE looks like a key — a copy-paste of the path instead of the text', () => {
    // The other half: a key that resolves to something that is itself a dotted
    // path is a catalogue entry somebody filled in with the key by mistake, and
    // it renders exactly as badly as a missing one.
    const suspicious = ALL.filter((u) => {
      const value = t(u.key);
      return value !== u.key && /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+){2,}$/.test(value);
    }).map((u) => `${u.key} → ${t(u.key)}`);
    expect(suspicious).toEqual([]);
  });
});

/**
 * **The other direction — a key nobody uses still ships — is NOT guarded here,
 * and the reason is recorded rather than left as an omission** (2026-08-17).
 *
 * The defect is real and has appeared three times: `admin.users.create`
 * («إضافة حساب») outlived the button it labelled and was found by a *bundle
 * probe* that read it as the control still being there; removing the completion
 * view and the in-page level-subjects editor orphaned twenty-three more, each
 * removed by hand and verified against the served bundle.
 *
 * **A general guard was written and then withdrawn.** Scanning for a leaf that no
 * source file mentions flags **~213 keys**, the great majority of which are alive
 * and reached by computed key — `t(\`profile.childStatus.${status}\`)`,
 * `t(\`calendar.recurrence.${type}\`)`, the module registries' `labelKey` data,
 * and the server's `message_key` values resolved from the wire. Making it pass
 * would need an allow-list of roughly two hundred prefixes, and **an allow-list
 * that large is one nobody maintains** — it would be updated by adding entries
 * until it stopped failing, which is the failure mode this project's own
 * documentation warns about for exactly this kind of guard.
 *
 * So the narrow, checkable case is guarded instead: `atomic-components.test.tsx`
 * asserts that the account-creation strings specifically stay absent, because
 * that is where an orphan would be *re-rendered by a future screen* rather than
 * merely shipped.
 *
 * **The ~213 unreferenced leaves are a real cleanup task**, reported to the
 * Document Owner rather than half-solved here. Closing it properly means giving
 * the computed families a machine-readable home — a keyed map per family rather
 * than a template literal — which is a refactor with its own scope.
 */
