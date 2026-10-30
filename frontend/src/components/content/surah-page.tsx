import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { fetchContentUrl, type ContentItem } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { Details } from '../history/humanity-details.js';
import { HumanityDiagram } from '../history/humanity-diagram.js';
import { SURAH_DIAGRAMS } from '../history/surah-diagrams.js';
import { Icon } from '../ui/icon.js';
import { authorLine, ContentCard } from './content-card.js';
import { QuizButton } from './surah-quiz.js';

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
  revelation,
  startOpen = false,
  focusId = null,
}: {
  /**
   * R255 — an item a link names («المواد المرفقة» of a session): its section
   * and year open on arrival and it is brought into view, marked.
   */
  focusId?: string | null;
  /** Every section open from the start (a static render, as «فتح الكل» leaves it). */
  startOpen?: boolean;
  surah: number;
  title: string;
  items: readonly SurahItem[];
  /** R240 — «نوع السورة» for a Surah with nothing written yet. */
  revelation?: 'makki' | 'madani';
  /** «نظرة شاملة» moves the focus to the new heading after a move. */
  headingRef?: RefObject<HTMLHeadingElement | null>;
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const profile = SURAH_DIAGRAMS.get(surah);
  // R247 — a page of a recording or of its session is shown beside it, not on a shelf.
  const pages = slidesOf(items);
  const shelves = SECTIONS.map((section) => ({
    ...section,
    items: items.filter((item) => !pages.ids.has(item.id) && section.holds(item)),
  })).filter((section) => section.items.length > 0);
  const diagrams = profile?.diagrams ?? [];
  // R250 — the Surah's details are a section of their own, «خصائص السورة», closed like the rest.
  const profileLines =
    profile && profile.lines.length > 0
      ? profile.lines
      : revelation
        ? [`${t('content.bySurah.typeLabel')}: ${t(`content.bySurah.revelation.${revelation}`)}`]
        : [];
  const keys = [
    ...(profileLines.length > 0 ? ['profile'] : []),
    ...(diagrams.length > 0 ? ['diagrams'] : []),
    ...shelves.map((section) => section.key),
  ];
  // R239 — every section opens and closes.
  // R240 — every section closed on arrival (the Owner: «by default, طيّ الكل»).
  // R255 — the linked item, or the recording a linked page belongs to.
  const focusItem = (() => {
    if (focusId === null) return null;
    const item = items.find((i) => i.id === focusId) ?? null;
    if (item && pages.ids.has(item.id) && item.slide_of) return items.find((i) => i.id === item.slide_of) ?? item;
    return item;
  })();
  const focusSection = focusItem ? (shelves.find((s) => s.items.includes(focusItem))?.key ?? null) : null;
  const [open, setOpen] = useState<Set<string>>(
    () => new Set([...(startOpen ? keys : []), ...(focusSection ? [focusSection] : [])]),
  );
  const toggle = (key: string): void =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // R239 — after one lesson ends, the next one plays (on by default).
  const [autoNext, setAutoNext] = useState<boolean>(() => readAutoNext());
  const [cue, setCue] = useState<number | null>(null);
  /**
   * R247 — «تسجيلات الدروس» and «مطبوعات الدروس» by academic year, newest
   * first, each year closed — unless the section has one year only, which is
   * open from the start. A year's key is flipped from that default.
   */
  const [flipped, setFlipped] = useState<Set<string>>(() => {
    // R255 — the linked item's year open (a section of one year already is).
    if (!focusItem || (focusSection !== 'listen' && focusSection !== 'slides')) return new Set();
    const years = byYear(shelves.find((s) => s.key === focusSection)!.items);
    return years.length > 1 ? new Set([`${focusSection}:${focusItem.academic_year_label ?? ''}`]) : new Set();
  });
  // Once, on arrival (the id does not change): the reader moves on from here.
  const focusedId = focusItem?.id ?? null;
  useEffect(() => {
    if (focusedId === null) return;
    const node = document.querySelector(`[data-content-id="${CSS.escape(focusedId)}"]`);
    node?.classList.add('is-focused');
    node?.scrollIntoView({ block: 'center' });
  }, [focusedId]);
  const yearOpen = (key: string, single: boolean): boolean => (single || startOpen) !== flipped.has(key);
  const flip = (key: string): void =>
    setFlipped((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /** R247 — the session whose recording is playing: its pages open. */
  const [playingSession, setPlayingSession] = useState<string | null>(null);

  const yearHeading = (key: string, year: string, single: boolean): ReactNode => (
    <h4 className="surah-library__yearTitle">
      <button
        type="button"
        className="surah-library__yearToggle"
        aria-expanded={yearOpen(key, single)}
        onClick={() => flip(key)}
      >
        {t('content.bySurah.year').replace('{year}', year)}
        <span className="surah-library__chevron" aria-hidden="true">
          {yearOpen(key, single) ? '−' : '+'}
        </span>
      </button>
    </h4>
  );

  const heading = (key: string, icon: Parameters<typeof Icon>[0]['name'], label: string): ReactNode => (
    <h3 id={`surah-${key}-title`} className="surah-library__sectionTitle">
      <button
        type="button"
        className="surah-library__toggle"
        aria-expanded={open.has(key)}
        aria-controls={`surah-${key}-body`}
        onClick={() => toggle(key)}
      >
        <Icon name={icon} size={18} />
        {label}
        {/* «+» closed, «−» open — what a diagram's own boxes show. */}
        <span className="surah-library__chevron" aria-hidden="true">
          {open.has(key) ? '−' : '+'}
        </span>
      </button>
    </h3>
  );

  return (
    <>
      <header className="surah-library__head">
        <h2 id="surah-library-title" className="surah-library__title" ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        {/* R239 — every section of the page at once, in the title bar. */}
        {keys.length > 1 ? (
          <div className="surah-library__toolbar">
            <button type="button" className="hdiagram__action" onClick={() => setOpen(new Set(keys))}>
              {t('content.bySurah.openAll')}
            </button>
            <button type="button" className="hdiagram__action" onClick={() => setOpen(new Set())}>
              {t('content.bySurah.closeAll')}
            </button>
          </div>
        ) : null}
      </header>

      {profileLines.length > 0 ? (
        <section id="surah-profile" className="surah-library__section surah-library__section--profile" aria-labelledby="surah-profile-title">
          {heading('profile', 'book', t('content.bySurah.section.profile'))}
          {open.has('profile') ? (
            <div id="surah-profile-body" className="surah-library__profile">
              <Details lines={profileLines} />
            </div>
          ) : null}
        </section>
      ) : null}

      {diagrams.length > 0 ? (
        <section
          id="surah-diagrams"
          className="surah-library__section surah-library__section--diagrams"
          aria-labelledby="surah-diagrams-title"
        >
          {heading('diagrams', 'book', t('content.bySurah.section.diagrams'))}
          {open.has('diagrams') ? (
            <div id="surah-diagrams-body" className="humanity__diagrams surah-library__diagrams">
              {diagrams.map((diagram) => (
                <HumanityDiagram key={diagram.title} diagram={diagram} heading={title} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {shelves.map((section) => (
        <section
          key={section.key}
          id={`surah-${section.key}`}
          className={`surah-library__section surah-library__section--${section.key}`}
          aria-labelledby={`surah-${section.key}-title`}
        >
          {heading(section.key, section.icon, t(`content.bySurah.section.${section.key}`))}
          {!open.has(section.key) ? null : section.key === 'listen' ? (
            <div id={`surah-${section.key}-body`}>
              <label className="surah-library__autonext">
                <input
                  type="checkbox"
                  checked={autoNext}
                  onChange={(event) => {
                    setAutoNext(event.target.checked);
                    storeAutoNext(event.target.checked);
                  }}
                />
                {t('content.bySurah.autoNext')}
              </label>
              {(() => {
                const years = byYear(section.items);
                const single = years.length === 1;
                // The play order runs across the years, newest first, as drawn.
                const order = years.flatMap((year) => year.items);
                const keyOf = (item: SurahItem): string => `listen:${item.academic_year_label ?? ''}`;
                return years.map((year) => {
                  const key = `listen:${year.year}`;
                  const drawn = new Set<string>();
                  return (
                    <div key={key} className="surah-library__year">
                      {yearHeading(key, year.year, single)}
                      {yearOpen(key, single) ? (
                        <ol className="surah-library__tracks">
                          {year.items.map((item, index) => {
                            const at = order.indexOf(item);
                            // R247 — a session's pages, once, above its first recording here.
                            const session = (item.session_ids ?? []).find((id) => pages.bySession.has(id)) ?? null;
                            const first = session !== null && !drawn.has(session);
                            if (session !== null) drawn.add(session);
                            return (
                              <Fragment key={item.id}>
                                {first && session !== null ? (
                                  <li className="surah-slides surah-slides--session">
                                    <SlideViewer
                                      slides={pages.bySession.get(session) ?? []}
                                      label={t('content.bySurah.sessionSlides')}
                                      revealed={playingSession === session}
                                      accessToken={accessToken}
                                      activeChildId={activeChildId}
                                      onOpen={onOpen}
                                    />
                                  </li>
                                ) : null}
                                <AudioTrack
                                  surah={surah}
                                  item={item}
                                  index={index + 1}
                                  slides={pages.byRecording.get(item.id) ?? []}
                                  accessToken={accessToken}
                                  activeChildId={activeChildId}
                                  onOpen={onOpen}
                                  cued={cue === at}
                                  onStarted={() => setPlayingSession(session)}
                                  onFinished={() => {
                                    const next = autoNext && at + 1 < order.length ? at + 1 : null;
                                    // The next lesson may open a closed year.
                                    if (next !== null && !yearOpen(keyOf(order[next]!), single)) flip(keyOf(order[next]!));
                                    setCue(next);
                                  }}
                                />
                              </Fragment>
                            );
                          })}
                        </ol>
                      ) : null}
                    </div>
                  );
                });
              })()}
              {/* R241 — one quiz over every lesson of the Surah. */}
              <div className="surah-quiz__final">
                <QuizButton surah={surah} quizKey="final" label={t('content.quiz.final')} final />
              </div>
            </div>
          ) : (
            <div id={`surah-${section.key}-body`} className="surah-library__shelf">
              {section.key === 'slides'
                ? (() => {
                    // R247 — «مطبوعات الدروس» by academic year, as the recordings are.
                    const years = byYear(section.items);
                    return years.map((year) => {
                      const key = `slides:${year.year}`;
                      return (
                        <div key={key} className="surah-library__year">
                          {yearHeading(key, year.year, years.length === 1)}
                          {yearOpen(key, years.length === 1) ? (
                            <ul className="content-list">
                              {year.items.map((item) => (
                                <ContentCard key={item.id} item={item} onOpen={onOpen} />
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    });
                  })()
                : null}
              {section.key !== 'slides' && section.items.some((item) => item.kind !== 'image') ? (
                <ul className="content-list">
                  {section.items
                    .filter((item) => item.kind !== 'image')
                    .map((item) => (
                      <ContentCard key={item.id} item={item} onOpen={onOpen} />
                    ))}
                </ul>
              ) : null}
              {/* Drawings of the Surah's ideas are shown as themselves (R196). */}
              {section.items.some((item) => item.kind === 'image') ? (
                <ul className="surah-library__gallery">
                  {section.items
                    .filter((item) => item.kind === 'image')
                    .map((item) => (
                      <ImageTile
                        key={item.id}
                        item={item}
                        accessToken={accessToken}
                        activeChildId={activeChildId}
                        onOpen={onOpen}
                      />
                    ))}
                </ul>
              ) : null}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

/**
 * **R212 — the lesson's handout; R239 — «مطبوعات الدروس»** (the Owner,
 * 2026-10-25: «replace the usage of the word شرائح with the word مطبوع»).
 * Nothing stored says a file is one, so the title does: «مطبوع» (or the
 * former «شرائح»), or a presentation file. Everything else to read is
 * «ملخصات ومذكرات».
 */
export function isSlides(item: Pick<ContentItem, 'title' | 'mime_type'>): boolean {
  return /مطبوع|شرائح/.test(item.title) || /presentation|powerpoint/i.test(item.mime_type);
}

const isReading = (item: ContentItem): boolean => item.kind === 'pdf' || item.kind === 'document';

/** R247 — items by academic year, the newest first; each year keeps the items' order. */
export function byYear<T extends Pick<ContentItem, 'academic_year_label'>>(
  items: readonly T[],
): { year: string; items: T[] }[] {
  const years = new Map<string, T[]>();
  for (const item of items) {
    const year = item.academic_year_label ?? '';
    years.set(year, [...(years.get(year) ?? []), item]);
  }
  return [...years.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([year, list]) => ({ year, items: list }));
}

/**
 * **R247 — which images are pages of what is heard** (the Owner, 2026-10-28).
 * A recording's own (`slide_of`, in `slide_position` order), and a class
 * session's: the images attached to a session one of this page's recordings
 * belongs to, in the page's order. `ids` — every image shown that way, which
 * no shelf repeats.
 */
export function slidesOf(items: readonly SurahItem[]): {
  byRecording: Map<string, SurahItem[]>;
  bySession: Map<string, SurahItem[]>;
  ids: Set<string>;
} {
  const audio = items.filter((item) => item.kind === 'audio');
  const recordings = new Set(audio.map((item) => item.id));
  const sessions = new Set(audio.flatMap((item) => item.session_ids ?? []));
  const byRecording = new Map<string, SurahItem[]>();
  const bySession = new Map<string, SurahItem[]>();
  const ids = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'image') continue;
    if (item.slide_of && recordings.has(item.slide_of)) {
      byRecording.set(item.slide_of, [...(byRecording.get(item.slide_of) ?? []), item]);
      ids.add(item.id);
      continue;
    }
    for (const session of item.session_ids ?? []) {
      if (!sessions.has(session)) continue;
      bySession.set(session, [...(bySession.get(session) ?? []), item]);
      ids.add(item.id);
    }
  }
  for (const list of byRecording.values()) list.sort((a, b) => (a.slide_position ?? 0) - (b.slide_position ?? 0));
  return { byRecording, bySession, ids };
}

/**
 * **R247 — the pages of what is being heard**, one at a time: the image, «السابقة»
 * and «التالية», and where in the set it is. Closed until asked for — or until
 * its recording plays (`revealed`). A tap on the page opens it full screen.
 * Each image is fetched only when it is shown.
 */
function SlideViewer({
  slides,
  label,
  revealed,
  accessToken,
  activeChildId,
  onOpen,
}: {
  slides: readonly SurahItem[];
  label: string;
  revealed: boolean;
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const slide = slides[Math.min(at, slides.length - 1)];

  useEffect(() => {
    if (revealed) setOpen(true);
  }, [revealed]);

  useEffect(() => {
    if (!open || !slide || slide.id in urls) return;
    let live = true;
    void fetchContentUrl(slide.id, accessToken, activeChildId)
      .catch(() => null)
      .then((url) => {
        if (live) setUrls((was) => ({ ...was, [slide.id]: url }));
      });
    return () => {
      live = false;
    };
  }, [open, slide?.id]);

  if (!slide) return null;
  const url = urls[slide.id];
  return (
    <div className="surah-slides__viewer">
      <button
        type="button"
        className="surah-slides__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="image" size={16} />
        {label}
        <span className="surah-slides__count">({slides.length})</span>
        <span className="surah-library__chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <figure className="surah-slides__stage">
          <button type="button" className="surah-slides__page" onClick={() => onOpen(slide)} aria-label={slide.title}>
            {url ? <img src={url} alt={slide.title} /> : <Icon name="image" size={32} />}
          </button>
          {slides.length > 1 ? (
            <figcaption className="surah-slides__nav">
              {/* Right to left: the previous page is on the right, pointing right. */}
              <button
                type="button"
                className="surah-player__button"
                disabled={at === 0}
                onClick={() => setAt(at - 1)}
                aria-label={t('content.bySurah.slidePrev')}
              >
                <svg className="surah-player__glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <span className="surah-slides__where" dir="ltr">
                {at + 1} / {slides.length}
              </span>
              <button
                type="button"
                className="surah-player__button"
                disabled={at >= slides.length - 1}
                onClick={() => setAt(at + 1)}
                aria-label={t('content.bySurah.slideNext')}
              >
                <svg className="surah-player__glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </figcaption>
          ) : null}
        </figure>
      ) : null}
    </div>
  );
}

/**
 * A Surah's shelves, in the order the Owner listed them (R212). **R242** —
 * three: the recordings, the «مطبوعات», and «ملخصات ومذكرات» holding all the
 * rest (summaries, drawings, videos).
 */
const SECTIONS: readonly {
  key: 'listen' | 'slides' | 'read';
  icon: 'audio' | 'document';
  holds: (item: ContentItem) => boolean;
}[] = [
  { key: 'listen', icon: 'audio', holds: (item) => item.kind === 'audio' },
  { key: 'slides', icon: 'document', holds: (item) => isReading(item) && isSlides(item) },
  { key: 'read', icon: 'document', holds: (item) => item.kind !== 'audio' && !(isReading(item) && isSlides(item)) },
];

/** One playing at a time: starting a lesson pauses any other on the page. */
function pauseOthers(current: HTMLAudioElement): void {
  for (const audio of document.querySelectorAll('audio')) {
    if (audio !== current) audio.pause();
  }
}

/** `754` → «12:34»; `3754` → «1:02:34». */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s % 60)}` : `${String(m)}:${pad(s % 60)}`;
}

/**
 * **A lesson played in the page.**
 *
 * **R223 (the Owner, 2026-10-16).** A public lesson carries its stable address
 * (`stream_url`, §3.1), so its player shows at once and plays in ONE click;
 * `preload="none"` keeps the page from fetching any audio until then. A
 * private one still mints its URL on «استماع» (TD-12). Where it stopped is
 * kept on this device; a URL that expires mid-play is renewed from the same
 * second.
 *
 * **R239 (the Owner, 2026-10-25) — its own controls**: play/pause, «−10 ث»,
 * and a bar whose listened part is the logo's orange and the rest the same
 * orange, lighter — kept on this device, so a lesson already heard reads as
 * heard. When it ends, the page plays the next one (`onFinished`; on by
 * default, «تشغيل التالي تلقائيًا»).
 */
export function AudioTrack({
  surah,
  item,
  index,
  slides,
  accessToken,
  activeChildId,
  onOpen,
  cued,
  onStarted,
  onFinished,
}: {
  surah: number;
  item: SurahItem;
  index: number;
  /** R247 — the pages of its «مطبوع», shown under it; they open as it plays. */
  slides: readonly SurahItem[];
  accessToken: string | null;
  activeChildId: string | null;
  onOpen: (item: ContentItem) => void;
  /** R239 — the previous lesson just ended: start this one. */
  cued: boolean;
  /** R247 — it began playing (its session's pages open). */
  onStarted: () => void;
  onFinished: () => void;
}): ReactNode {
  const direct = item.stream_url ?? null;
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'missing'>(direct ? 'ready' : 'idle');
  const [url, setUrl] = useState<string | null>(direct);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [current, setCurrent] = useState<number>(() => savedPlace(item.id) ?? 0);
  const [duration, setDuration] = useState<number>(() => savedDuration(item.id) ?? 0);
  /** Set when a renewed URL must resume where the old one stopped. */
  const resumeAt = useRef<number | null>(null);
  const renewals = useRef(0);
  /** Play as soon as the audio is ready (a click on a private lesson, or a cue). */
  const playWhenReady = useRef(false);

  /**
   * **R258 — read ahead what a press would wait for** (the Owner: «clicking on
   * play some audios, takes some seconds before it starts»). An m4a stored with
   * its index (`moov`) after the audio has to be read at its END before the
   * first sound; so a visible m4a row reads its index now, and pointing at the
   * play button warms any lesson. A private lesson mints its link then too.
   * The files themselves are untouched (the Owner: «Not now»).
   */
  const rowRef = useRef<HTMLLIElement | null>(null);
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (!direct || !item.mime_type.includes('mp4')) return;
    const node = rowRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((entry) => entry.isIntersecting)) {
          setWarm(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [direct, item.mime_type]);
  const prefetching = useRef(false);
  function warmUp(): void {
    setWarm(true);
    if (direct || url !== null || prefetching.current) return;
    prefetching.current = true;
    void mint().then((minted) => {
      if (minted === null || url !== null) return;
      setUrl(minted);
      setState('ready');
    });
  }

  async function mint(): Promise<string | null> {
    try {
      return await fetchContentUrl(item.id, accessToken, activeChildId);
    } catch {
      return null;
    }
  }

  async function load(): Promise<void> {
    setState('loading');
    playWhenReady.current = true;
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
    playWhenReady.current = true;
    const minted = await mint();
    if (minted === null) {
      setState('missing');
      return;
    }
    audio.src = minted;
    audio.load();
    setUrl(minted);
  }

  function play(): void {
    const audio = audioRef.current;
    if (!audio) {
      void load();
      return;
    }
    pauseOthers(audio);
    // A finished lesson starts again from the beginning.
    if (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 1) audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }

  // R239 — the previous lesson ended: this one starts.
  useEffect(() => {
    if (!cued) return;
    if (state === 'ready') play();
    else void load();
  }, [cued]);

  const total = duration > 0 ? duration : 0;
  const listened = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <li className="surah-track" data-content-id={item.id} ref={rowRef}>
      <span className="surah-track__index" aria-hidden="true">
        {index}
      </span>
      <div className="surah-track__body">
        <p className="surah-track__title">{item.title}</p>
        {item.description ? <p className="surah-track__description">{item.description}</p> : null}
        {/* R239 — only who teaches it; the Subject and the date said nothing the page did not. */}
        {item.teacher_display_name ? (
          <p className="surah-track__meta">
            <span>{authorLine(item)}</span>
          </p>
        ) : null}
        {state === 'missing' ? (
          <p className="surah-track__error" role="status">
            {t('content.bySurah.unavailable')}
          </p>
        ) : (
          <div className="surah-player">
            <button
              type="button"
              className="surah-player__button surah-player__button--play"
              disabled={state === 'loading'}
              onPointerEnter={warmUp}
              onFocus={warmUp}
              onTouchStart={warmUp}
              onClick={() => (playing ? audioRef.current?.pause() : play())}
              aria-label={`${playing ? t('content.bySurah.pause') : t('content.bySurah.play')} — ${item.title}`}
            >
              {/* R242 — drawn, not the «▶» character: a phone's font turned it into an emoji. */}
              <svg className="surah-player__glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M5 2.5v11l9-5.5z" />}
              </svg>
            </button>
            <button
              type="button"
              className="surah-player__button"
              disabled={state !== 'ready'}
              onClick={() => {
                const audio = audioRef.current;
                if (audio) audio.currentTime = Math.max(0, audio.currentTime - 10);
              }}
              aria-label={t('content.bySurah.back10')}
              title={t('content.bySurah.back10')}
            >
              {/* R243 — the arrow turns toward the start: in this right-to-left bar, rightwards. */}
              <svg className="surah-player__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  transform="matrix(-1 0 0 1 24 0)"
                  d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
                />
              </svg>
              <span aria-hidden="true">10</span>
            </button>
            <input
              type="range"
              className="surah-player__bar"
              min={0}
              max={total || 1}
              step={1}
              value={Math.min(current, total || 1)}
              disabled={state !== 'ready' || total === 0}
              style={{ ['--listened' as string]: `${String(listened)}%` }}
              aria-label={t('content.bySurah.seek')}
              aria-valuetext={`${clock(current)} / ${clock(total)}`}
              onChange={(event) => {
                const at = Number(event.target.value);
                setCurrent(at);
                if (audioRef.current) audioRef.current.currentTime = at;
              }}
            />
            <span className="surah-player__time" dir="ltr">
              {clock(current)} / {clock(total)}
            </span>
            {/* R256 — every item downloads, a recording too: one more button in
                this row, so the row does not grow. A separate `attachment` URL,
                as the preview's own «تنزيل الملف» mints. */}
            <button
              type="button"
              className="surah-player__button surah-player__button--download"
              disabled={downloading}
              onClick={() => {
                setDownloading(true);
                void fetchContentUrl(item.id, accessToken, activeChildId, 'attachment')
                  .then((link) => {
                    if (link) window.open(link, '_blank', 'noopener,noreferrer');
                  })
                  .catch(() => undefined)
                  .finally(() => setDownloading(false));
              }}
              aria-label={`${t('content.download')} — ${item.title}`}
              title={t('content.download')}
            >
              <Icon name="download" size={18} />
            </button>
          </div>
        )}
        {slides.length > 0 ? (
          <SlideViewer
            slides={slides}
            label={t('content.bySurah.trackSlides')}
            revealed={playing}
            accessToken={accessToken}
            activeChildId={activeChildId}
            onOpen={onOpen}
          />
        ) : null}
        {/* R241 — «اختبار الفهم» of this lesson, where it has one. */}
        <QuizButton surah={surah} quizKey={item.id} label={t('content.quiz.open')} />
        {state === 'ready' && url ? (
          <audio
            ref={audioRef}
            preload={direct && !warm ? 'none' : 'metadata'}
            src={url}
            onPlay={(event) => {
              pauseOthers(event.currentTarget);
              setPlaying(true);
              onStarted();
            }}
            onPause={(event) => {
              setPlaying(false);
              keepPlace(item.id, event.currentTarget.currentTime, true);
            }}
            onLoadedMetadata={(event) => {
              const audio = event.currentTarget;
              if (Number.isFinite(audio.duration)) {
                setDuration(audio.duration);
                keepDuration(item.id, audio.duration);
              }
              const at = resumeAt.current ?? savedPlace(item.id);
              resumeAt.current = null;
              if (at !== null && at > 0 && (!Number.isFinite(audio.duration) || at < audio.duration - 5)) {
                audio.currentTime = at;
              }
              if (playWhenReady.current) {
                playWhenReady.current = false;
                pauseOthers(audio);
                void audio.play().catch(() => undefined);
              }
            }}
            onTimeUpdate={(event) => {
              setCurrent(event.currentTarget.currentTime);
              keepPlace(item.id, event.currentTarget.currentTime);
            }}
            onError={(event) => void renew(event.currentTarget)}
            onEnded={(event) => {
              const audio = event.currentTarget;
              // An end well before the duration is a read that failed, not the end.
              if (Number.isFinite(audio.duration) && audio.currentTime < audio.duration - 2) {
                void renew(audio);
                return;
              }
              // Heard to the end: the bar stays full (R239), and the next one plays.
              keepPlace(item.id, audio.duration, true);
              setCurrent(audio.duration);
              setPlaying(false);
              onFinished();
            }}
          >
            {t('content.previewUnsupported')}
          </audio>
        ) : null}
      </div>
    </li>
  );
}

/* ── R223 — where a lesson was stopped, on this device; R239 — and its length ── */

const placeKey = (id: string): string => `bodour.audio.${id}`;
const durationKey = (id: string): string => `bodour.audio.${id}.length`;
const AUTO_NEXT_KEY = 'bodour.audio.autoNext';
const lastWrite = new Map<string, number>();

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    const at = raw === null ? NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function writeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage refused (private window, full): it is simply not kept.
  }
}

const savedPlace = (id: string): number | null => readNumber(placeKey(id));
const savedDuration = (id: string): number | null => readNumber(durationKey(id));
const keepDuration = (id: string, seconds: number): void => writeValue(durationKey(id), String(Math.floor(seconds)));

/** Written at most every 5 s while playing, and at once on pause or end. */
function keepPlace(id: string, at: number, now = false): void {
  const last = lastWrite.get(id) ?? 0;
  if (!now && Date.now() - last < 5000) return;
  lastWrite.set(id, Date.now());
  writeValue(placeKey(id), String(Math.floor(at)));
}

/** R239 — on unless the reader turned it off on this device. */
function readAutoNext(): boolean {
  try {
    return window.localStorage.getItem(AUTO_NEXT_KEY) !== 'off';
  } catch {
    return true;
  }
}

function storeAutoNext(on: boolean): void {
  writeValue(AUTO_NEXT_KEY, on ? 'on' : 'off');
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
