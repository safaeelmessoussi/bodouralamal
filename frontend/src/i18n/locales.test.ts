import { describe, expect, it } from 'vitest';

import { EXPEDITIONS, HUMANITY, PHASES, TIMELINE } from '../components/history/humanity-data.js';
import { localiseHumanity, type ContentDictionary } from '../components/history/humanity-i18n.js';
import type { DiagramNode, HistoryNode } from '../components/history/humanity-model.js';
import { ar } from './ar.js';
import { LOCALES, type FlatCatalog } from './index.js';

/**
 * **SRS Revision 209 — every translation the public pages ship is whole.**
 * The interface catalogues name only keys Arabic has, all the same keys, with
 * the same `{placeholders}` and list lengths; «نظرة شاملة»'s dictionaries
 * leave no Arabic but the Qur'an's verses (and Arabic quotations in «…»),
 * which they carry unchanged.
 */
const UI = import.meta.glob<FlatCatalog>('./locales/*.json', { eager: true, import: 'default' });
const CONTENT = import.meta.glob<ContentDictionary>('../components/history/locales/*.json', {
  eager: true,
  import: 'default',
});
const nameOf = (path: string): string => path.split('/').at(-1)!.replace(/\.json$/, '');

function flatten(node: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) flatten(value, prefix ? `${prefix}.${key}` : key, out);
  } else out[prefix] = node;
  return out;
}
const ARABIC = flatten(ar);
const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();
const verses = (text: string): string[] => text.match(/﴿[^﴾]*﴾/g) ?? [];
const arabicOutsideQuotes = (text: string): boolean =>
  /[ء-ي]/.test(text.replace(/﴿[^﴾]*﴾/g, '').replace(/«[^»]*»/g, ''));

describe('R209 — the interface translations', () => {
  const locales = Object.keys(UI).map(nameOf).sort();

  it('ship every language the menu offers but Arabic', () => {
    expect(locales).toEqual(LOCALES.filter((l) => l !== 'ar').sort());
  });

  it('name only keys Arabic has, the same keys in every language, placeholders and lists intact', () => {
    const reference = Object.keys(Object.values(UI)[0]!).sort();
    for (const [path, catalog] of Object.entries(UI)) {
      const locale = nameOf(path);
      expect(Object.keys(catalog).sort(), locale).toEqual(reference);
      for (const [key, value] of Object.entries(catalog)) {
        const source = ARABIC[key];
        expect(source, `${locale}: ${key} is not an Arabic key`).toBeDefined();
        if (Array.isArray(source)) {
          expect(Array.isArray(value) && value.length === source.length, `${locale}: ${key}`).toBe(true);
        } else {
          expect(typeof value === 'string' && value.trim() !== '', `${locale}: ${key}`).toBe(true);
          expect(placeholders(value as string), `${locale}: ${key}`).toEqual(placeholders(source as string));
          expect(arabicOutsideQuotes(value as string), `${locale}: ${key} keeps Arabic`).toBe(false);
        }
      }
    }
  });
});

describe('R209 — «نظرة شاملة» in every language', () => {
  const content = { root: HUMANITY, timeline: TIMELINE, phases: PHASES, expeditions: EXPEDITIONS };

  function strings(node: HistoryNode, out: string[] = []): string[] {
    out.push(node.title, node.subtitle ?? '', node.summary ?? '', node.badge ?? '', node.when?.gregorian ?? '', node.when?.hijri ?? '', ...(node.lines ?? []));
    const box = (b: DiagramNode): void => {
      out.push(b.label, b.text ?? '');
      b.children?.forEach(box);
    };
    for (const d of node.diagrams ?? []) {
      out.push(d.title);
      box(d.root);
    }
    node.children?.forEach((child) => strings(child, out));
    return out;
  }

  it('ships a dictionary for every language', () => {
    expect(Object.keys(CONTENT).map(nameOf).sort()).toEqual(LOCALES.filter((l) => l !== 'ar').sort());
  });

  it('every key is one the tree reads, and every string the tree shows is translated', () => {
    // Each key mapped to itself: what the tree shows afterwards is exactly the keys it read.
    const probe = Object.fromEntries(Object.keys(Object.values(CONTENT)[0]!).map((k) => [k, `«${k}»`]));
    const shown = localiseHumanity(content, probe);
    const all = [
      ...strings(shown.root),
      ...shown.timeline.flatMap((m) => [m.label, m.gregorian, m.hijri]),
      ...shown.phases.flatMap((p) => [p.label, p.sub]),
      ...shown.expeditions.flatMap((e) => [e.label, e.hijri, e.gregorian]),
    ].filter((s) => s !== '');
    const read = new Set(all.filter((s) => s.startsWith('«')).map((s) => s.slice(1, -1)));
    expect([...Object.keys(probe)].filter((k) => !read.has(k)), 'keys the tree never reads').toEqual([]);
    expect(all.filter((s) => !s.startsWith('«')), 'strings left untranslated').toEqual([]);
  });

  it('keeps every verse, byte for byte, and no Arabic outside quotations', () => {
    const arabic = localiseHumanity(content, null);
    const keyed = new Map<string, string>();
    const probe = Object.fromEntries(Object.keys(Object.values(CONTENT)[0]!).map((k) => [k, k]));
    // Arabic source by key: localise with a dictionary that names each key, compare positions.
    const named = strings(localiseHumanity(content, probe).root);
    const source = strings(arabic.root);
    named.forEach((key, i) => keyed.set(key, source[i]!));
    for (const [path, dict] of Object.entries(CONTENT)) {
      const locale = nameOf(path);
      for (const [key, value] of Object.entries(dict)) {
        const original = keyed.get(key);
        if (original === undefined) continue;
        for (const verse of verses(original)) expect(value.includes(verse), `${locale}: ${key} lost a verse`).toBe(true);
        expect(arabicOutsideQuotes(value), `${locale}: ${key} keeps Arabic`).toBe(false);
      }
    }
  });
});
