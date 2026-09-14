import { useEffect, useState, type ReactNode } from 'react';

import { fetchPrograms, type PublicProgramCategory } from '../adapters/programs.js';
import { t } from '../i18n/index.js';
import { Badge } from './ui/badge.js';
import { Container } from './ui/container.js';

/**
 * «برامجنا التعليمية» — the §5.1 programme overview (Revision 144,
 * Owner-reported 2026-09-14).
 *
 * Placed before `BranchesSection` on the landing page. Entirely data-driven
 * from `GET /programs` (TD-3.16): every Category the admin taxonomy screens
 * hold, each Category's Levels, and each Level's مواد المستوى/مقرر الحفظ —
 * so a Level added or a Subject assigned in the back office appears here
 * with no frontend change, the same property `BranchesSection` already has
 * for branches.
 *
 * §14.4 requires every surface to declare which state it is in. Unlike
 * `PartnersSection` (where an empty list is the association's ordinary,
 * ungoverned state), an empty programme catalogue would be a genuine fault —
 * the association always teaches something — so this follows
 * `BranchesSection`'s pattern: loading, error and empty are each shown, not
 * silently collapsed to nothing.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; categories: PublicProgramCategory[] }
  | { kind: 'error' };

export function ProgramsSection(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const categories = await fetchPrograms();
        if (!cancelled) setState({ kind: 'ready', categories });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="programs" className="section" aria-labelledby="programs-title">
      <Container>
        <div className="section__head">
          <span className="eyebrow">{t('programs.eyebrow')}</span>
          <h2 id="programs-title" className="section__title">
            {t('programs.title')}
          </h2>
          <p className="lede">{t('programs.lede')}</p>
        </div>

        <div aria-live="polite" aria-busy={state.kind === 'loading'}>
          {state.kind === 'loading' ? <ProgramSkeletons /> : null}
          {state.kind === 'error' ? <p className="muted">{t('programs.error')}</p> : null}
          {state.kind === 'ready' && state.categories.length === 0 ? (
            <p className="muted">{t('programs.empty')}</p>
          ) : null}
          {state.kind === 'ready' && state.categories.length > 0 ? (
            <div className="grid grid--3">
              {state.categories.map((category) => (
                <CategoryCard key={category.id} category={category} />
              ))}
            </div>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

function CategoryCard({ category }: { category: PublicProgramCategory }): ReactNode {
  return (
    <article className="card">
      <h3>{category.name}</h3>
      {category.description ? <p className="muted">{category.description}</p> : null}
      {category.levels.length === 0 ? (
        <p className="muted">{t('programs.noLevels')}</p>
      ) : (
        <ul className="programs__levels">
          {category.levels.map((level) => (
            <li key={level.id} className="programs__level">
              <p className="programs__levelName">{level.name}</p>
              {level.description ? <p className="muted">{level.description}</p> : null}
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
          ))}
        </ul>
      )}
    </article>
  );
}

/** Skeletons rather than a spinner, matching §14.4's tabular loading standard. */
function ProgramSkeletons(): ReactNode {
  return (
    <div className="grid grid--3" aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <div className="card" key={key}>
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--wide" />
          <div className="skeleton skeleton--medium" />
          <div className="skeleton skeleton--narrow" />
        </div>
      ))}
    </div>
  );
}
