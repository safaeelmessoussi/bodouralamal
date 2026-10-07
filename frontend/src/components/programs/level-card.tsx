import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import type { PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
import { Badge } from '../ui/badge.js';
import {
  levelAgeWords,
  memorisationWords,
  programmeSubjects,
  seasonalSubjects,
} from './journey-model.js';

/**
 * **One Level, as a card** — the road's stop (R180 §7) and the full-screen
 * show's slide (R185 §5) read the same markup, so the two can never say
 * different things about a Level.
 *
 * The Level's NAME is the title, in the pill «المستوى N» wore (R184 §1):
 * nothing numbered by the page; «المستوى 1» or «السنة 1» is the Super Admin's
 * to put in the description. Then its ages, its own Subjects (a seasonal
 * course apart, R183 §1), «حفظ وتفسير: N أحزاب» (R182 §3) and its Surahs.
 * Everything a reader can know is on the card — there is no «التفاصيل» any
 * more (R185 §4).
 *
 * `idPrefix` keeps the two copies' ids apart when both are in the document.
 */
export function LevelCard({
  level,
  idPrefix = 'journey-level',
  className = '',
  surahsInFull = false,
}: {
  level: PublicProgramLevel;
  idPrefix?: string;
  className?: string;
  /** R208 — «عرض بملء الشاشة» lists every Surah, with no «…». */
  surahsInFull?: boolean;
}): ReactNode {
  const ages = levelAgeWords(level, t);
  const memorisation = memorisationWords(level, t);
  const id = `${idPrefix}-${level.id}`;
  return (
    <article
      className={`journey__card${className ? ` ${className}` : ''}`}
      id={id}
      aria-labelledby={`${id}-title`}
    >
      {ages ? (
        <p className="journey__cardKicker">
          <span className="journey__cardAge">{ages}</span>
        </p>
      ) : null}
      <h4 className="journey__cardTitle" id={`${id}-title`}>
        {level.name}
      </h4>
      {level.description ? <p className="journey__cardText">{level.description}</p> : null}
      {programmeSubjects(level.subjects).length > 0 ? (
        <p className="journey__cardRow">
          <span className="journey__cardRowLabel">{t('programs.subjectsLabel')}</span>
          {programmeSubjects(level.subjects).map((subject) => (
            <Badge key={subject.id}>{subject.name}</Badge>
          ))}
        </p>
      ) : null}
      {/* R183 §1 — a seasonal course the Level carries, apart from its programme. */}
      {seasonalSubjects(level.subjects).length > 0 ? (
        <p className="journey__cardRow journey__cardRow--seasonal">
          <span className="journey__cardRowLabel">{t('programs.seasonalLabel')}</span>
          {seasonalSubjects(level.subjects).map((subject) => (
            <Badge key={subject.id}>{subject.name}</Badge>
          ))}
        </p>
      ) : null}
      {memorisation ? <p className="journey__cardMemo">{memorisation}</p> : null}
      <SurahList level={level} full={surahsInFull} />
    </article>
  );
}

// A static render (tests, the server) has no layout; the browser does.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * R182 §3 / R185 §2 — the Level's Surahs under «حفظ وتفسير: N أحزاب»: the
 * first few lines (the stylesheet clamps them — four on a laptop, two on a
 * phone), then «…» which opens the whole list, and «عرض أقل» which folds it
 * again. The «…» is offered only when the clamp actually hides something,
 * measured — a short list shows no control at all.
 */
export function SurahList({
  level,
  full = false,
}: {
  level: PublicProgramLevel;
  /** R208 — the whole list, no clamp and no «…» (the full-screen show). */
  full?: boolean;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const text = useRef<HTMLSpanElement | null>(null);
  useIsomorphicLayoutEffect(() => {
    const node = text.current;
    if (!node) return;
    const measure = (): void => {
      if (expanded) return;
      setClipped(node.scrollHeight > node.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, level.surahs]);
  if (level.surahs.length === 0) return null;
  if (full) {
    return (
      <p className="journey__surahs is-expanded is-full">
        <span className="journey__surahsText">
          {level.surahs.map((s) => s.name).join('، ')}
        </span>
      </p>
    );
  }
  return (
    <p className={`journey__surahs${expanded ? ' is-expanded' : ''}`}>
      <span className="journey__surahsText" ref={text}>
        {level.surahs.map((s) => s.name).join('، ')}
      </span>
      {!expanded && clipped ? (
        <button
          type="button"
          className="journey__surahsMore"
          aria-label={t('programs.journey.surahsMore')}
          onClick={() => setExpanded(true)}
        >
          …
        </button>
      ) : null}
      {expanded ? (
        <button type="button" className="journey__surahsLess" onClick={() => setExpanded(false)}>
          {t('programs.journey.surahsLess')}
        </button>
      ) : null}
    </p>
  );
}
