import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import type { FramingPreferenceView } from '../../types/framing.js';

export type { FramingPreferenceView } from '../../types/framing.js';

/**
 * General framing willingness captured during a هيئة التأطير request (R115).
 *
 * One value component serves the approval queue and both teaching-profile
 * views. That matters because `all_branches` is future-inclusive, not shorthand
 * for today's branch names, and `online` deliberately carries no branch. A
 * copied formatter is where either meaning would eventually be lost.
 *
 * This renders planning data only. It is intentionally not an input on the
 * teaching profile: weekly availability and the staff-request preference are
 * separate statements, and neither grants authority.
 */
export function FramingPreferenceValue({
  framing,
}: {
  framing: FramingPreferenceView | null;
}): ReactNode {
  if (!framing) return <span className="muted">{t('framing.notStated')}</span>;
  const mode = t(`register.framingMode_${framing.mode}`);
  if (framing.mode === 'online') return mode;
  const branches = framing.all_branches
    ? t('framing.allBranches')
    : framing.branches.map((branch) => branch.name).join('، ');
  return `${mode} — ${branches}`;
}

export function FramingPreferenceSummary({
  framing,
}: {
  framing: FramingPreferenceView | null;
}): ReactNode {
  return (
    <section className="form">
      <h2 className="form__legend">{t('framing.generalTitle')}</h2>
      <p>
        <FramingPreferenceValue framing={framing} />
      </p>
      <p className="field__hint">{t('framing.generalHint')}</p>
    </section>
  );
}
