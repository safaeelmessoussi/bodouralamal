import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchPrograms, type PublicProgramCategory } from '../adapters/programs.js';
import { t } from '../i18n/index.js';
import { buildJourney } from './programs/journey-model.js';
import { ProgramsJourney } from './programs/programs-journey.js';
import { ProgramsTextView } from './programs/programs-text-view.js';
import { Container } from './ui/container.js';

/**
 * «برامجنا التعليمية» — the §5.1 programme overview (Revision 144), redesigned
 * as a JOURNEY by SRS Revision 180: the Levels climb from the youngest
 * Category's first step to the summit, an arrow leads from each to the
 * next (R182 §6), a graduation ends every Category, and «عرض جميع البرامج»
 * opens the same catalogue as text to scan.
 *
 * Placed before `BranchesSection` on the landing page. Entirely data-driven
 * from `GET /programs` (TD-3.16): every Category the admin taxonomy screens
 * hold, each Category's Levels with their ages and journey role, and each
 * Level's مواد المستوى/مقرر الحفظ — so a Level added, re-aged or reordered in
 * the back office appears here with no frontend change, the same property
 * `BranchesSection` already has for branches.
 *
 * §14.4 requires every surface to declare which state it is in. Unlike
 * `PartnersSection` (where an empty list is the association's ordinary,
 * ungoverned state), an empty programme catalogue would be a genuine fault —
 * the association always teaches something — so this follows
 * `BranchesSection`'s pattern: loading, error and empty are each shown, not
 * silently collapsed to nothing.
 */
type State =
  { kind: 'loading' } | { kind: 'ready'; categories: PublicProgramCategory[] } | { kind: 'error' };

export function ProgramsSection(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [textView, setTextView] = useState<{ open: boolean; levelId: string | null }>({
    open: false,
    levelId: null,
  });

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

  const categories = state.kind === 'ready' ? state.categories : [];
  const journey = useMemo(() => buildJourney(categories), [categories]);
  const openText = (levelId: string | null): void => setTextView({ open: true, levelId });

  return (
    <section id="programs" className="section" aria-labelledby="programs-title">
      <Container>
        <div className="section__head programs__head">
          <h2 id="programs-title" className="section__title">
            {t('programs.title')}
          </h2>
          <p className="lede programs__lede">{t('programs.lede')}</p>
          {/* R187 §3 — «عرض جميع البرامج» stands beside «عرض بملء الشاشة» in
              the road's own controls, not here. */}
        </div>

        <div aria-live="polite" aria-busy={state.kind === 'loading'}>
          {state.kind === 'loading' ? <ProgramSkeletons /> : null}
          {state.kind === 'error' ? <p className="muted">{t('programs.error')}</p> : null}
          {state.kind === 'ready' && journey.categories.length === 0 ? (
            <p className="muted">{t('programs.empty')}</p>
          ) : null}
          {state.kind === 'ready' && journey.categories.length > 0 ? (
            <ProgramsJourney journey={journey} onTextView={() => openText(null)} />
          ) : null}
        </div>

        {state.kind === 'ready' ? (
          <ProgramsTextView
            open={textView.open}
            onClose={() => setTextView({ open: false, levelId: null })}
            journey={journey}
            categories={state.categories}
            focusLevelId={textView.levelId}
          />
        ) : null}
      </Container>
    </section>
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
