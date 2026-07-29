import { useEffect, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../adapters/branches.js';
import { t } from '../i18n/index.js';
import { BranchCard } from './branch-card.js';
import { Container } from './ui/container.js';

/**
 * «فروعنا ومعلومات التواصل» — the §5.1 branch list.
 *
 * Entirely data-driven: everything comes from `GET /branches` (TD-3.9), so a
 * branch added in the back office appears here with **no frontend change**.
 * Nothing about a branch is hardcoded, including how many there are.
 *
 * §14.4 requires every surface to declare which state it is in, and this one
 * has three that matter — loading, failed, and genuinely empty. The failure
 * state is deliberately quiet: a public landing page should degrade to "we
 * could not load this" rather than show a broken frame or an error dialog.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; branches: PublicBranch[] }
  | { kind: 'error' };

export function BranchesSection(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const branches = await fetchBranches();
        if (!cancelled) setState({ kind: 'ready', branches });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="branches" className="section section--tint" aria-labelledby="branches-title">
      <Container>
        <div className="section__head">
          <span className="eyebrow">{t('branches.eyebrow')}</span>
          <h2 id="branches-title" className="section__title">
            {t('branches.title')}
          </h2>
          <p className="lede">{t('branches.lede')}</p>
        </div>

        {/* The region is announced as busy while loading, so a screen reader is
            told the list is coming rather than that the section is empty. */}
        <div aria-live="polite" aria-busy={state.kind === 'loading'}>
          {state.kind === 'loading' ? <BranchSkeletons /> : null}
          {state.kind === 'error' ? <p className="muted">{t('branches.error')}</p> : null}
          {state.kind === 'ready' && state.branches.length === 0 ? (
            <p className="muted">{t('branches.empty')}</p>
          ) : null}
          {state.kind === 'ready' && state.branches.length > 0 ? (
            <div className="grid grid--2">
              {state.branches.map((branch) => (
                <BranchCard key={branch.id} branch={branch} />
              ))}
            </div>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

/** Skeletons rather than a spinner, matching §14.4's tabular loading standard. */
function BranchSkeletons(): ReactNode {
  return (
    <div className="grid grid--2" aria-hidden="true">
      {[0, 1].map((key) => (
        <div className="card" key={key}>
          <div className="skeleton" style={{ width: '45%', height: '1.4rem' }} />
          <div className="skeleton" style={{ width: '80%' }} />
          <div className="skeleton" style={{ width: '60%' }} />
          <div className="skeleton" style={{ width: '70%' }} />
        </div>
      ))}
    </div>
  );
}
