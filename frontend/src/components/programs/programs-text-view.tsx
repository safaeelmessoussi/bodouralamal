import { useEffect, useRef, type ReactNode } from 'react';

import type { PublicProgramCategory, PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
import { Badge } from '../ui/badge.js';
import { Dialog } from '../ui/dialog.js';
import { ageWords, levelAgeWords, type Journey } from './journey-model.js';

/**
 * **«عرض جميع البرامج» — the same journey, to scan** (SRS Revision 180 §10).
 *
 * A dialog rather than a second page: it opens over the section the reader
 * is on and closes back to it. It reads the SAME `Journey` the illustration
 * reads — Categories in journey order, each with its derived age range, its
 * preparatory programme where it has one, its steps in order with their own
 * ages, descriptions, Subjects and «مقرر الحفظ», and the graduation that ends
 * it — so the two can never say different things. A Category with no Levels
 * (not on the road) is still listed here, honestly empty.
 */
export function ProgramsTextView({
  open,
  onClose,
  journey,
  categories,
  focusLevelId,
}: {
  open: boolean;
  onClose: () => void;
  journey: Journey;
  /** Every Category the API returned, for the ones with no Levels. */
  categories: PublicProgramCategory[];
  /** The Level to bring into view on open (from a card's «التفاصيل»). */
  focusLevelId: string | null;
}): ReactNode {
  const body = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || focusLevelId === null) return;
    const target = body.current?.querySelector<HTMLElement>(`#programs-text-level-${focusLevelId}`);
    target?.scrollIntoView({ block: 'start' });
  }, [open, focusLevelId]);

  const onRoad = new Set(journey.categories.map((category) => category.id));
  const emptyCategories = categories.filter((category) => !onRoad.has(category.id));

  return (
    <Dialog open={open} onClose={onClose} title={t('programs.textView.title')} wide>
      <div className="programs-text" ref={body}>
        <p className="lede">{t('programs.textView.lede')}</p>
        {journey.categories.map((category) => (
          <section
            key={category.id}
            className="programs-text__category"
            aria-labelledby={`programs-text-category-${category.id}`}
          >
            <header className="programs-text__head">
              <h3 id={`programs-text-category-${category.id}`}>
                {t('programs.textView.categoryOrdinal').replace('{n}', String(category.position))} {category.name}
              </h3>
              {ageWords(category, t) ? <p className="programs-text__age">{ageWords(category, t)}</p> : null}
              {category.description ? <p className="muted">{category.description}</p> : null}
              {category.directEntry ? (
                <p className="muted">{t('programs.journey.directEntry').replace('{category}', category.name)}</p>
              ) : null}
            </header>
            <ol className="programs-text__levels">
              {category.preparatory.map((level) => (
                <LevelRow
                  key={level.id}
                  level={level}
                  focus={focusLevelId === level.id}
                  kicker={t('programs.journey.preparatory')}
                  note={t('programs.journey.preparatoryLeadsTo').replace(
                    '{step}',
                    category.steps[0]?.level.name ?? category.name,
                  )}
                  prep
                />
              ))}
              {category.steps.map((step) => (
                <LevelRow
                  key={step.level.id}
                  level={step.level}
                  focus={focusLevelId === step.level.id}
                  kicker={t('programs.journey.stepOrdinal').replace('{n}', String(step.position))}
                />
              ))}
            </ol>
            <p className="programs-text__milestone">
              {t('programs.journey.graduationText').replace('{category}', category.name)}
            </p>
          </section>
        ))}
        {emptyCategories.map((category) => (
          <section key={category.id} className="programs-text__category">
            <header className="programs-text__head">
              <h3>{category.name}</h3>
              {category.description ? <p className="muted">{category.description}</p> : null}
            </header>
            <p className="muted">{t('programs.noLevels')}</p>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

function LevelRow({
  level,
  kicker,
  note,
  focus,
  prep = false,
}: {
  level: PublicProgramLevel;
  kicker: string;
  note?: string;
  focus: boolean;
  prep?: boolean;
}): ReactNode {
  const ages = levelAgeWords(level, t);
  return (
    <li
      id={`programs-text-level-${level.id}`}
      className={`programs-text__level${prep ? ' programs-text__level--prep' : ''}${focus ? ' programs-text__level--focus' : ''}`}
    >
      <p className="programs-text__levelName">
        <span className="journey__cardOrdinal">{kicker}</span>
        {level.name}
        {ages ? <span className="programs-text__age">{ages}</span> : null}
      </p>
      {level.description ? <p className="muted">{level.description}</p> : null}
      {note ? <p className="muted">{note}</p> : null}
      {level.subjects.length > 0 ? (
        <p className="programs__row">
          <span className="programs__rowLabel">{t('programs.subjectsLabel')}</span>
          {level.subjects.map((subject) => (
            <Badge key={subject.id}>{subject.name}</Badge>
          ))}
        </p>
      ) : null}
      {level.surahs.length > 0 ? (
        <p className="programs__row programs__row--text">
          <span className="programs__rowLabel">{t('programs.surahsLabel')}</span>
          {level.surahs.map((s) => s.name).join('، ')}
        </p>
      ) : null}
    </li>
  );
}
