import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { fetchContentUrl, type ContentItem } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { Details } from '../history/humanity-details.js';
import { HumanityDiagram } from '../history/humanity-diagram.js';
import { SURAH_DIAGRAMS } from '../history/surah-diagrams.js';
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
  const diagrams = profile?.diagrams ?? [];
  const keys = [...(diagrams.length > 0 ? ['diagrams'] : []), ...shelves.map((section) => section.key)];
  // R239 — every section opens and closes; the diagrams start closed when
  // there are several, so the recordings are in view on arrival.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(keys.filter((key) => key !== 'diagrams' || diagrams.length <= 1)),
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

      {profile && profile.lines.length > 0 ? (
        <div className="surah-library__profile">
          <Details lines={profile.lines} />
        </div>
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
              <ol className="surah-library__tracks">
                {section.items.map((item, index) => (
                  <AudioTrack
                    key={item.id}
                    item={item}
                    index={index + 1}
                    accessToken={accessToken}
                    activeChildId={activeChildId}
                    cued={cue === index}
                    onFinished={() => setCue(autoNext && index + 1 < section.items.length ? index + 1 : null)}
                  />
                ))}
              </ol>
            </div>
          ) : section.key === 'see' ? (
            <ul id={`surah-${section.key}-body`} className="surah-library__gallery">
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
            <ul id={`surah-${section.key}-body`} className="content-list">
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
function AudioTrack({
  item,
  index,
  accessToken,
  activeChildId,
  cued,
  onFinished,
}: {
  item: SurahItem;
  index: number;
  accessToken: string | null;
  activeChildId: string | null;
  /** R239 — the previous lesson just ended: start this one. */
  cued: boolean;
  onFinished: () => void;
}): ReactNode {
  const direct = item.stream_url ?? null;
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'missing'>(direct ? 'ready' : 'idle');
  const [url, setUrl] = useState<string | null>(direct);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState<number>(() => savedPlace(item.id) ?? 0);
  const [duration, setDuration] = useState<number>(() => savedDuration(item.id) ?? 0);
  /** Set when a renewed URL must resume where the old one stopped. */
  const resumeAt = useRef<number | null>(null);
  const renewals = useRef(0);
  /** Play as soon as the audio is ready (a click on a private lesson, or a cue). */
  const playWhenReady = useRef(false);

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
    <li className="surah-track">
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
              onClick={() => (playing ? audioRef.current?.pause() : play())}
              aria-label={`${playing ? t('content.bySurah.pause') : t('content.bySurah.play')} — ${item.title}`}
            >
              <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
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
              <span aria-hidden="true">↺10</span>
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
          </div>
        )}
        {state === 'ready' && url ? (
          <audio
            ref={audioRef}
            preload={direct ? 'none' : 'metadata'}
            src={url}
            onPlay={(event) => {
              pauseOthers(event.currentTarget);
              setPlaying(true);
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
