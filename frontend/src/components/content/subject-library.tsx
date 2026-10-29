import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ContentItem, LibraryEntry } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { ContentCard } from './content-card.js';
import { byTitle } from './surah-library.js';
import { AudioTrack, slidesOf, type SurahItem } from './surah-page.js';

/**
 * **R256 — what is general, not split by Level** (the Owner: «محتوى عام to
 * show the content of مواد مشتركة في كل المستويات and of دورات موسمية»): an
 * item whose Subject is a «دورة موسمية» (R183 §1) or is offered to every Level
 * of its Category (R172 §1), or one addressed to the whole Category (R167 §5).
 * Never an item about a Surah: «تفسير» holds those.
 */
export function isGeneralEntry(entry: LibraryEntry): boolean {
  return (
    entry.surah_id === null &&
    (entry.subject_seasonal || entry.subject_shared || entry.shelf_kind === 'whole_category')
  );
}

export interface SubjectGroup {
  /** The Subject's id, or `''` for an item of no Subject («عام»). */
  id: string;
  name: string;
  items: SurahItem[];
}

/** The general items by Subject, each item once, recordings in title order. */
export function groupBySubject(entries: readonly LibraryEntry[]): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isGeneralEntry(entry) || entry.item.slide_of) continue;
    const id = entry.subject_id ?? '';
    if (seen.has(`${id}:${entry.item.id}`)) continue;
    seen.add(`${id}:${entry.item.id}`);
    let group = groups.get(id);
    if (!group) {
      group = { id, name: entry.subject_name ?? t('content.generalNoSubject'), items: [] };
      groups.set(id, group);
    }
    group.items.push({ ...entry.item, subjectName: entry.subject_name });
  }
  // A recording's own pages come with it, as on a Surah's page (R247).
  const pages = entries.filter((e) => e.item.slide_of);
  for (const group of groups.values()) {
    const recordings = new Set(group.items.filter((i) => i.kind === 'audio').map((i) => i.id));
    for (const page of pages) {
      if (recordings.has(page.item.slide_of!) && !group.items.some((i) => i.id === page.item.id)) {
        group.items.push({ ...page.item, subjectName: page.subject_name });
      }
    }
    group.items.reverse();
    group.items.sort(byTitle);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/**
 * **R256 — «محتوى عام», read by Subject, as «تفسير» is read by Surah** (the
 * Owner: «a page presenting content by subject … the audio to be listened to on
 * top with the rest of the contents below it, to look like surahs page … use
 * menu on the right to list subjects»). The same index, the same recording
 * rows and the same cards as the Surah page, so a reader who knows one knows
 * the other. No filters.
 */
export function SubjectLibrary({
  entries,
  initialSubject,
  focusId = null,
  accessToken,
  activeChildId,
  onOpen,
}: {
  entries: readonly LibraryEntry[];
  /** `?subject=` — a shared link opens on its Subject; else the first. */
  initialSubject: string | null;
  /** The item a link names, on its Subject's page. */
  focusId?: string | null;
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const subjects = useMemo(() => groupBySubject(entries), [entries]);
  const [chosen, setChosen] = useState<string | null>(initialSubject);
  const current = subjects.find((s) => s.id === chosen) ?? subjects[0] ?? null;
  const panel = useRef<HTMLElement | null>(null);

  if (current === null) {
    return (
      <div className="state">
        <p>{t('content.generalEmpty')}</p>
      </div>
    );
  }

  function choose(id: string): void {
    setChosen(id);
    const url = new URL(window.location.href);
    url.searchParams.set('subject', id);
    window.history.replaceState(null, '', url);
    // A phone stacks the list above the panel: bring the panel up.
    if (window.matchMedia('(max-width: 44rem)').matches) {
      panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  return (
    <div className="surah-library subject-library">
      <nav className="surah-library__index" aria-label={t('content.generalIndexLabel')}>
        <ol className="surah-library__list">
          {subjects.map((subject) => (
            <li key={subject.id}>
              <button
                type="button"
                className={`surah-library__surah${subject.id === current.id ? ' is-active' : ''}`}
                aria-current={subject.id === current.id ? 'true' : undefined}
                onClick={() => choose(subject.id)}
              >
                <span className="surah-library__name">{subject.name}</span>
                <span className="surah-library__count">{subject.items.filter((i) => !i.slide_of).length}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section ref={panel} className="surah-library__panel" aria-labelledby="subject-library-title" key={current.id}>
        <SubjectPage
          group={current}
          focusId={current.id === initialSubject ? focusId : null}
          accessToken={accessToken}
          activeChildId={activeChildId}
          onOpen={onOpen}
        />
      </section>
    </div>
  );
}

function SubjectPage({
  group,
  focusId,
  accessToken,
  activeChildId,
  onOpen,
}: {
  group: SubjectGroup;
  focusId: string | null;
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const pages = slidesOf(group.items);
  const recordings = group.items.filter((i) => i.kind === 'audio');
  const rest = group.items.filter((i) => i.kind !== 'audio' && !pages.ids.has(i.id));
  // After one recording ends, the next plays — as on a Surah's page (R239).
  const [cue, setCue] = useState<number | null>(null);

  useEffect(() => {
    if (focusId === null) return;
    const node = document.querySelector(`[data-content-id="${CSS.escape(focusId)}"]`);
    node?.classList.add('is-focused');
    node?.scrollIntoView({ block: 'center' });
  }, [focusId]);

  return (
    <>
      <h2 id="subject-library-title" className="surah-library__title">
        {group.name}
      </h2>
      {recordings.length > 0 ? (
        <section className="surah-library__section surah-library__section--listen" aria-label={t('content.generalListen')}>
          <ol className="surah-library__tracks">
            {recordings.map((item, index) => (
              <AudioTrack
                key={item.id}
                surah={0}
                item={item}
                index={index + 1}
                slides={pages.byRecording.get(item.id) ?? []}
                accessToken={accessToken}
                activeChildId={activeChildId}
                onOpen={onOpen}
                cued={cue === index}
                onStarted={() => undefined}
                onFinished={() => setCue(index + 1 < recordings.length ? index + 1 : null)}
              />
            ))}
          </ol>
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section className="surah-library__section surah-library__shelf" aria-label={t('content.generalRest')}>
          <ul className="content-list">
            {rest.map((item) => (
              <ContentCard key={item.id} item={item} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
