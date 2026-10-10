import { useMemo, useRef, useState, type ReactNode } from 'react';

import type { ContentItem, LibraryEntry } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { SURAH_DIAGRAMS, type SurahDiagrams } from '../history/surah-diagrams.js';
import { SurahPage, type SurahItem } from './surah-page.js';

/**
 * **«حسب السورة» — the library read by Surah** (SRS Revision 196).
 *
 * For a visitor who is not one of the association's مستفيدات and does not
 * think in Categories and Levels: she wants to study ONE Surah. On the right
 * (the start side), the Surahs that have content, in Mushaf order; on the
 * left, everything the library holds about the chosen one, grouped by what it
 * is — lessons to listen to, played right here; notes and summaries to read;
 * drawings and maps of the Surah's ideas; videos — each opening as before.
 *
 * It reads the SAME rows the Level view reads (`GET /library`, the caller's
 * own tiers already applied server-side), filtered to those that name a
 * Surah (R177 §7) and de-duplicated: an item filed for several Levels is one
 * item here. Nothing is fetched per Surah, and a recording's playable URL is
 * minted only when she presses play (TD-12: a presigned URL is fetched when
 * it is used, never when a list is drawn).
 */
export interface SurahGroup {
  id: number;
  name: string;
  items: SurahItem[];
}

const TITLE_ORDER = new Intl.Collator('ar', { numeric: true, sensitivity: 'base', ignorePunctuation: true });
/** R199 §3 — items in their titles' order, numbers compared as numbers. Stable. */
export function byTitle(a: { title: string }, b: { title: string }): number {
  return TITLE_ORDER.compare(a.title.replace(/\s+/g, ' ').trim(), b.title.replace(/\s+/g, ' ').trim());
}

/** The Surahs that have content, in Mushaf order, each item once. */
export function groupBySurah(entries: readonly LibraryEntry[]): SurahGroup[] {
  const groups = new Map<number, SurahGroup>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.surah_id === null) continue;
    const key = `${entry.surah_id}:${entry.item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let group = groups.get(entry.surah_id);
    if (!group) {
      group = { id: entry.surah_id, name: entry.surah_name ?? String(entry.surah_id), items: [] };
      groups.set(entry.surah_id, group);
    }
    group.items.push({ ...entry.item, subjectName: entry.subject_name });
  }
  // R199 §3 (the Owner) — a Surah's recordings in TITLE order, numbers read
  // as numbers («الحصة 2» before «الحصة 10»), so the order is the one the
  // titles say whatever order the files were uploaded in; equal titles keep
  // the oldest first (the library answers newest first).
  for (const group of groups.values()) {
    group.items.reverse();
    group.items.sort(byTitle);
  }
  return [...groups.values()].sort((a, b) => a.id - b.id);
}

/**
 * **R210 — a Surah «نظرة شاملة» draws is in the index too**, with or without
 * content: its diagrams are what the reader meets first. Mushaf order.
 */
export function withDiagramSurahs(
  groups: readonly SurahGroup[],
  diagrams: ReadonlyMap<number, Pick<SurahDiagrams, 'surah' | 'name'>>,
): SurahGroup[] {
  const all = new Map(groups.map((group) => [group.id, group]));
  for (const { surah, name } of diagrams.values()) {
    if (!all.has(surah)) all.set(surah, { id: surah, name, items: [] });
  }
  return [...all.values()].sort((a, b) => a.id - b.id);
}

export function SurahLibrary({
  entries,
  initialSurah,
  accessToken,
  activeChildId,
  onOpen,
}: {
  entries: readonly LibraryEntry[];
  /** `?surah=` — a shared link opens on its Surah; else the first that has content. */
  initialSurah: number | null;
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const surahs = useMemo(() => withDiagramSurahs(groupBySurah(entries), SURAH_DIAGRAMS), [entries]);
  const [chosen, setChosen] = useState<number | null>(initialSurah);
  const current = surahs.find((s) => s.id === chosen) ?? surahs[0] ?? null;
  const panel = useRef<HTMLElement | null>(null);

  if (current === null) {
    return (
      <div className="state">
        <p>{t('content.bySurah.empty')}</p>
      </div>
    );
  }

  function choose(id: number): void {
    setChosen(id);
    const url = new URL(window.location.href);
    url.searchParams.set('surah', String(id));
    window.history.replaceState(null, '', url);
    // A phone stacks the list above the panel: bring the panel up.
    if (window.matchMedia('(max-width: 44rem)').matches) {
      panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  return (
    <div className="surah-library">
      <nav className="surah-library__index" aria-label={t('content.bySurah.indexLabel')}>
        <p className="surah-library__indexTitle">{t('content.bySurah.indexTitle')}</p>
        <ol className="surah-library__list">
          {surahs.map((surah) => (
            <li key={surah.id}>
              <button
                type="button"
                className={`surah-library__surah${surah.id === current.id ? ' is-active' : ''}`}
                aria-current={surah.id === current.id ? 'true' : undefined}
                onClick={() => choose(surah.id)}
              >
                <span className="surah-library__number" aria-hidden="true">
                  {surah.id}
                </span>
                <span className="surah-library__name">{surah.name}</span>
                {surah.items.length > 0 ? (
                  <span className="surah-library__count">{surah.items.length}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section
        ref={panel}
        className="surah-library__panel"
        aria-labelledby="surah-library-title"
        key={current.id}
      >
        {/* R212 — the same Surah page «نظرة شاملة» shows. */}
        <SurahPage
          surah={current.id}
          title={t('content.surahGroupLabel').replace('{surah}', current.name)}
          items={current.items}
          accessToken={accessToken}
          activeChildId={activeChildId}
          onOpen={onOpen}
        />
      </section>
    </div>
  );
}
