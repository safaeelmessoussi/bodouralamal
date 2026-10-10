import { useEffect, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react';

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
 * **A lesson played in the page.** The presigned URL is minted when the
 * reader presses «استماع» (TD-12), then the native player takes over —
 * keyboard, scrubbing and the phone's lock-screen controls for free.
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
          {item.teacher_display_name ? <span>{authorLine(item)}</span> : null}
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
          {url ? <img className="surah-tile__image" src={url} alt="" loading="lazy" /> : <Icon name="image" size={32} />}
        </span>
        <span className="surah-tile__title">{item.title}</span>
      </button>
    </li>
  );
}
