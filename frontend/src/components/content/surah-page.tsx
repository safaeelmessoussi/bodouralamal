import { useEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react';

import { fetchContentUrl, type ContentItem } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { Details } from '../history/humanity-details.js';
import { HumanityDiagram } from '../history/humanity-diagram.js';
import { SURAH_DIAGRAMS } from '../history/surah-diagrams.js';
import { Button } from '../ui/button.js';
import { Icon } from '../ui/icon.js';
import { authorLine, ContentCard } from './content-card.js';

/** An item of the library filed under a Surah, with the Subject it was taught in. */
export type SurahItem = ContentItem & { subjectName: string | null };

/**
 * **R212 — the one Surah page** (the Owner, 2026-10-10: «clicking on any
 * surahs in both places, should show same things»). «حسب السورة» and «نظرة
 * شاملة» draw a Surah with this component and nothing else, in this order:
 *
 * 1. its name (and the tree's subtitle, when it has one);
 * 2. what «نظرة شاملة» says of it — «نوع السورة»، «المحاور الأساس»… — read as
 *    sections, without a heading of its own;
 * 3. «خطاطات السورة», every tree closed;
 * 4. «تسجيلات الدروس», «شرائح الدروس», «ملخصات ومذكرات», «رسوم ومخططات», then
 *    videos — each shown only when the Surah has some.
 *
 * Nothing else: no summary chips repeating the sections, no lede and no hint
 * under a section (R212 — they pushed the Surah's own content down).
 */
export function SurahPage({
  surah,
  title,
  items,
  headingRef,
  accessToken,
  activeChildId,
  onOpen,
}: {
  surah: number;
  title: string;
  items: readonly SurahItem[];
  /** «نظرة شاملة» moves the focus to the new heading after a move. */
  headingRef?: RefObject<HTMLHeadingElement | null>;
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const profile = SURAH_DIAGRAMS.get(surah);
  const shelves = SECTIONS.map((section) => ({ ...section, items: items.filter(section.holds) })).filter(
    (section) => section.items.length > 0,
  );
  return (
    <>
      <header className="surah-library__head">
        <h2 id="surah-library-title" className="surah-library__title" ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        {profile?.subtitle ? <p className="surah-library__subtitle">{profile.subtitle}</p> : null}
      </header>

      {profile && profile.lines.length > 0 ? (
        <div className="surah-library__profile">
          <Details lines={profile.lines} />
        </div>
      ) : null}

      {profile && profile.diagrams.length > 0 ? (
        <section
          id="surah-diagrams"
          className="surah-library__section surah-library__section--diagrams"
          aria-labelledby="surah-diagrams-title"
        >
          <h3 id="surah-diagrams-title" className="surah-library__sectionTitle">
            <Icon name="book" size={18} />
            {t('content.bySurah.section.diagrams')}
          </h3>
          <div className="humanity__diagrams surah-library__diagrams">
            {profile.diagrams.map((diagram) => (
              <HumanityDiagram key={diagram.title} diagram={diagram} />
            ))}
          </div>
        </section>
      ) : null}

      {shelves.map((section) => (
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
    </>
  );
}

/**
 * **R212 — «شرائح الدروس»: a lesson's slides.** Nothing stored says a file is
 * slides, so the Owner chose the title: a file whose title says «شرائح», or a
 * presentation file (PowerPoint, OpenDocument). Everything else to read is
 * «ملخصات ومذكرات».
 */
export function isSlides(item: Pick<ContentItem, 'title' | 'mime_type'>): boolean {
  return item.title.includes('شرائح') || /presentation|powerpoint/i.test(item.mime_type);
}

const isReading = (item: ContentItem): boolean => item.kind === 'pdf' || item.kind === 'document';

/** A Surah's shelves, in the order the Owner listed them (R212). */
const SECTIONS: readonly {
  key: 'listen' | 'slides' | 'read' | 'see' | 'watch';
  icon: 'audio' | 'document' | 'image' | 'video';
  holds: (item: ContentItem) => boolean;
}[] = [
  { key: 'listen', icon: 'audio', holds: (item) => item.kind === 'audio' },
  { key: 'slides', icon: 'document', holds: (item) => isReading(item) && isSlides(item) },
  { key: 'read', icon: 'document', holds: (item) => isReading(item) && !isSlides(item) },
  { key: 'see', icon: 'image', holds: (item) => item.kind === 'image' },
  { key: 'watch', icon: 'video', holds: (item) => item.kind === 'video' },
];

/** One playing at a time: starting a lesson pauses any other on the page. */
function pauseOthers(event: SyntheticEvent<HTMLAudioElement>): void {
  for (const audio of document.querySelectorAll('audio')) {
    if (audio !== event.currentTarget) audio.pause();
  }
}

/**
 * **A lesson played in the page.**
 *
 * **R223 (the Owner, 2026-10-16).** A public lesson carries its stable address
 * (`stream_url`, §3.1), so its player shows at once and plays in ONE click;
 * `preload="none"` keeps the page from fetching any audio until then. A
 * private one still mints its URL on «استماع» (TD-12).
 *
 * - **Where it stopped is kept on this device** (`localStorage`, per item):
 *   it opens there next time, and finishing it forgets the place.
 * - **A URL that expires mid-play is renewed.** A 10-minute signature cut a
 *   1-hour lesson at its tenth minute, reading as «ended»; an error, or an end
 *   before the real end, mints again and carries on from the same second.
 */
function AudioTrack({
  item,
  index,
  accessToken,
  activeChildId,
}: {
  item: SurahItem;
  index: number;
  accessToken: string | null;
  activeChildId: string | null;
}): ReactNode {
  const direct = item.stream_url ?? null;
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'missing'>(direct ? 'ready' : 'idle');
  const [url, setUrl] = useState<string | null>(direct);
  /** Set when a renewed URL must resume where the old one stopped. */
  const resumeAt = useRef<number | null>(null);
  const renewals = useRef(0);

  async function mint(): Promise<string | null> {
    try {
      return await fetchContentUrl(item.id, accessToken, activeChildId);
    } catch {
      return null;
    }
  }

  async function load(): Promise<void> {
    setState('loading');
    const minted = await mint();
    if (minted === null) {
      setState('missing');
      return;
    }
    setUrl(minted);
    setState('ready');
  }

  /** A failed or cut-short read: a fresh URL, from the same second (3 tries). */
  async function renew(audio: HTMLAudioElement): Promise<void> {
    if (renewals.current >= 3) {
      setState('missing');
      return;
    }
    renewals.current += 1;
    resumeAt.current = audio.currentTime;
    const minted = await mint();
    if (minted === null) {
      setState('missing');
      return;
    }
    // A stable address is the same string: re-assigning it reloads it all the same.
    audio.src = minted;
    audio.load();
    setUrl(minted);
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
          {item.teacher_display_name ? <span>{authorLine(item)}</span> : null}
          {item.subjectName ? <span>{item.subjectName}</span> : null}
          <time dateTime={item.published_on}>{formatDate(item.published_on)}</time>
        </p>
        {state === 'ready' && url ? (
          <audio
            className="surah-track__player"
            controls
            // Played on «استماع» — the reader already asked; a direct player waits.
            autoPlay={!direct}
            preload={direct ? 'none' : 'metadata'}
            src={url}
            onPlay={pauseOthers}
            onLoadedMetadata={(event) => {
              const audio = event.currentTarget;
              const at = resumeAt.current ?? savedPlace(item.id);
              resumeAt.current = null;
              if (at !== null && at > 0 && (!Number.isFinite(audio.duration) || at < audio.duration - 5)) {
                audio.currentTime = at;
              }
              if (renewals.current > 0) void audio.play().catch(() => undefined);
            }}
            onTimeUpdate={(event) => keepPlace(item.id, event.currentTarget.currentTime)}
            onPause={(event) => keepPlace(item.id, event.currentTarget.currentTime, true)}
            onError={(event) => void renew(event.currentTarget)}
            onEnded={(event) => {
              const audio = event.currentTarget;
              // An end well before the duration is a read that failed, not the end.
              if (Number.isFinite(audio.duration) && audio.currentTime < audio.duration - 2) {
                void renew(audio);
                return;
              }
              forgetPlace(item.id);
            }}
          >
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

/* ── R223 — where a lesson was stopped, on this device ──────────────────── */

const placeKey = (id: string): string => `bodour.audio.${id}`;
const lastWrite = new Map<string, number>();

function savedPlace(id: string): number | null {
  try {
    const raw = window.localStorage.getItem(placeKey(id));
    const at = raw === null ? NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Written at most every 5 s while playing, and at once on pause. */
function keepPlace(id: string, at: number, now = false): void {
  const last = lastWrite.get(id) ?? 0;
  if (!now && Date.now() - last < 5000) return;
  lastWrite.set(id, Date.now());
  try {
    window.localStorage.setItem(placeKey(id), String(Math.floor(at)));
  } catch {
    // Storage refused (private window, full): the place is simply not kept.
  }
}

function forgetPlace(id: string): void {
  try {
    window.localStorage.removeItem(placeKey(id));
  } catch {
    // Nothing to forget.
  }
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
          {url ? <img className="surah-tile__image" src={url} alt="" loading="lazy" /> : <Icon name="image" size={32} />}
        </span>
        <span className="surah-tile__title">{item.title}</span>
      </button>
    </li>
  );
}
