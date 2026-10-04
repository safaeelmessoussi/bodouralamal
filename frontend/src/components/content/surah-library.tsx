import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

import { fetchContentUrl, type ContentItem, type LibraryEntry } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { Button } from '../ui/button.js';
import { Icon } from '../ui/icon.js';
import { ContentCard } from './content-card.js';

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
  items: (ContentItem & { subjectName: string | null })[];
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
  // The library answers newest first; a Surah is studied from its first
  // lesson on, so each Surah's items read oldest first.
  for (const group of groups.values()) group.items.reverse();
  return [...groups.values()].sort((a, b) => a.id - b.id);
}

/** The four shelves of one Surah, in the order a learner meets them. */
const SECTIONS = [
  { key: 'listen', kinds: ['audio'], icon: 'audio' },
  { key: 'read', kinds: ['pdf', 'document'], icon: 'document' },
  { key: 'see', kinds: ['image'], icon: 'image' },
  { key: 'watch', kinds: ['video'], icon: 'video' },
] as const;

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
  const surahs = useMemo(() => groupBySurah(entries), [entries]);
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

  const counts = SECTIONS.map((section) => ({
    ...section,
    items: current.items.filter((item) => (section.kinds as readonly string[]).includes(item.kind)),
  })).filter((section) => section.items.length > 0);

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
                <span className="surah-library__count">{surah.items.length}</span>
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
        <header className="surah-library__head">
          <h2 id="surah-library-title" className="surah-library__title">
            {t('content.surahGroupLabel').replace('{surah}', current.name)}
          </h2>
          <p className="surah-library__lede">
            {t('content.bySurah.lede').replace('{surah}', current.name)}
          </p>
          <ul className="surah-library__summary">
            {counts.map((section) => (
              <li key={section.key}>
                <a href={`#surah-${section.key}`} className="surah-library__chip">
                  <Icon name={section.icon} size={16} />
                  {t(`content.bySurah.section.${section.key}`)}
                  <span className="surah-library__chipCount">{section.items.length}</span>
                </a>
              </li>
            ))}
          </ul>
        </header>

        {counts.map((section) => (
          <section
            key={section.key}
            id={`surah-${section.key}`}
            className={`surah-library__section surah-library__section--${section.key}`}
            aria-labelledby={`surah-${section.key}-title`}
          >
            <h3 id={`surah-${section.key}-title`} className="surah-library__sectionTitle">
              <Icon name={section.icon} size={18} />
              {t(`content.bySurah.section.${section.key}`)}
            </h3>
            <p className="surah-library__sectionHint">{t(`content.bySurah.hint.${section.key}`)}</p>
            {section.key === 'listen' ? (
              <ol className="surah-library__tracks">
                {section.items.map((item, index) => (
                  <AudioTrack
                    key={item.id}
                    item={item}
                    index={index + 1}
                    accessToken={accessToken}
                    activeChildId={activeChildId}
                  />
                ))}
              </ol>
            ) : section.key === 'see' ? (
              <ul className="surah-library__gallery">
                {section.items.map((item) => (
                  <ImageTile
                    key={item.id}
                    item={item}
                    accessToken={accessToken}
                    activeChildId={activeChildId}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            ) : (
              <ul className="content-list">
                {section.items.map((item) => (
                  <ContentCard key={item.id} item={item} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </section>
    </div>
  );
}

/** One playing at a time: starting a lesson pauses any other on the page. */
function pauseOthers(event: SyntheticEvent<HTMLAudioElement>): void {
  for (const audio of document.querySelectorAll('audio')) {
    if (audio !== event.currentTarget) audio.pause();
  }
}

/**
 * **A lesson played in the page.** The presigned URL is minted when she
 * presses «استماع» (TD-12), then the native player takes over — keyboard,
 * scrubbing and the phone's lock-screen controls for free.
 */
function AudioTrack({
  item,
  index,
  accessToken,
  activeChildId,
}: {
  item: ContentItem & { subjectName: string | null };
  index: number;
  accessToken: string | null;
  activeChildId: string | null;
}): ReactNode {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  const [url, setUrl] = useState<string | null>(null);

  async function load(): Promise<void> {
    setState('loading');
    try {
      const minted = await fetchContentUrl(item.id, accessToken, activeChildId);
      if (minted === null) {
        setState('missing');
        return;
      }
      setUrl(minted);
      setState('ready');
    } catch {
      setState('missing');
    }
  }

  return (
    <li className="surah-track">
      <span className="surah-track__index" aria-hidden="true">
        {index}
      </span>
      <div className="surah-track__body">
        <p className="surah-track__title">{item.title}</p>
        {item.description ? <p className="surah-track__description">{item.description}</p> : null}
        <p className="surah-track__meta">
          {item.subjectName ? <span>{item.subjectName}</span> : null}
          <time dateTime={item.published_on}>{formatDate(item.published_on)}</time>
        </p>
        {state === 'ready' && url ? (
          <audio
            className="surah-track__player"
            controls
            autoPlay
            preload="metadata"
            onPlay={pauseOthers}
            onError={() => setState('missing')}
          >
            <source src={url} type={item.mime_type} />
            {t('content.previewUnsupported')}
          </audio>
        ) : state === 'missing' ? (
          <p className="surah-track__error" role="status">
            {t('content.bySurah.unavailable')}
          </p>
        ) : null}
      </div>
      {state === 'ready' ? null : (
        <Button
          variant="primary"
          className="surah-track__play"
          disabled={state === 'loading'}
          onClick={() => void load()}
          aria-label={`${t('content.bySurah.play')} — ${item.title}`}
        >
          <Icon name="audio" size={18} />
          {state === 'loading' ? t('states.loading') : t('content.bySurah.play')}
        </Button>
      )}
    </li>
  );
}

/** A drawing or map of the Surah's ideas, shown as itself; opens full size. */
function ImageTile({
  item,
  accessToken,
  activeChildId,
  onOpen,
}: {
  item: ContentItem;
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchContentUrl(item.id, accessToken, activeChildId)
      .then((minted) => {
        if (!cancelled) setUrl(minted);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id, accessToken, activeChildId]);
  return (
    <li>
      <button type="button" className="surah-tile" onClick={() => onOpen(item)}>
        <span className="surah-tile__frame">
          {url ? (
            <img className="surah-tile__image" src={url} alt="" loading="lazy" />
          ) : (
            <Icon name="image" size={32} />
          )}
        </span>
        <span className="surah-tile__title">{item.title}</span>
      </button>
    </li>
  );
}
