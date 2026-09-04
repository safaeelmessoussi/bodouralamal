import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchStudentIdentity, type StudentIdentity } from '../../adapters/students.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { ErrorState } from '../../components/states.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useSession } from '../../contexts/session.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { t } from '../../i18n/index.js';
import { ButtonLink } from '../../components/ui/button.js';
import { UserQr } from '../../components/ui/user-qr.js';

/**
 * **حسابي — inside her portal, and where her enrolments now live** (R86).
 *
 * Her menu linked to `/profile`, which is correct for the PERSON (R65 put it
 * outside the portals deliberately: it is reachable whatever role you work as)
 * and wrong for the sidebar, which vanished on arrival. This is the framed way
 * in; `/profile` remains what it was for every other context.
 *
 * **The Category, Level and Branch moved here from لوحة المستفيدة**, on the
 * Owner's decision: the landing page shows nothing until it is designed, and
 * those facts are about her account rather than about her day.
 *
 * **Plural by construction.** A beneficiary holds one enrolment per Level and
 * may hold several (BR-21), so this renders a LIST and says so even when there
 * is one. The old block rendered `enrollments[0]` and was honest about it in a
 * comment; a screen that shows the first of several is a screen that will be
 * wrong the first time somebody enrols twice.
 */
export function StudentAccountPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeChildId } = useActiveChild();
  const [identity, setIdentity] = useState<StudentIdentity | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      setIdentity(await fetchStudentIdentity(accessToken, activeChildId));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accessToken, activeChildId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'error') {
    return (
      <StudentLayout title={t('student.nav.account')}>
        <ErrorState onRetry={() => void load()} />
      </StudentLayout>
    );
  }

  return (
    <StudentLayout title={t('student.nav.account')} lede={t('student.account.lede')}>
      <section className="card" aria-labelledby="account-identity">
        <h2 id="account-identity">{t('student.account.identity')}</h2>
        <dl className="detail-list">
          <dt>{t('student.account.name')}</dt>
          <dd>{identity?.name_arabic ?? '—'}</dd>
          {/* R62.6 — `null` for an adult and for accounts predating the code. */}
          {identity?.reference_code ? (
            <>
              <dt>{t('student.account.reference')}</dt>
              <dd>{identity.reference_code}</dd>
            </>
          ) : null}
        </dl>

        {/**
          * **R96 — the ACTING student's QR identity, which under child context
          * is the CHILD's.**
          *
          * `fetchStudentIdentity` is called with `activeChildId`, so a parent
          * viewing her daughter's account sees her daughter's card and a
          * beneficiary viewing her own sees hers. **Her own** — the parent's —
          * is on `/profile`, and the two are never silently exchanged: a card
          * printed for the wrong person is worse than no card at all.
          *
          * The caption names whose it is for exactly that reason. In a family
          * with three children, three unlabelled squares are indistinguishable.
          */}
        {identity ? (
          <>
            <h3>{t('qr.title')}</h3>
            <p className="muted">{t('qr.lede')}</p>
            <UserQr qr={identity.qr} caption={identity.name_arabic} />
          </>
        ) : null}
      </section>

      <section className="card" aria-labelledby="account-enrolments">
        <h2 id="account-enrolments">{t('student.account.enrolments')}</h2>

        {state === 'ready' && (identity?.enrollments.length ?? 0) === 0 ? (
          <p className="muted">{t('student.account.noEnrolments')}</p>
        ) : (
          <ul className="detail-list">
            {(identity?.enrollments ?? []).map((e) => (
              // Keyed by the LEVEL: BR-21 admits one live enrolment per Level,
              // so the pair is unique and the index would not be.
              <li key={e.level.id}>
                <strong>
                  {levelLabel({
                    id: e.level.id,
                    name: e.level.name,
                    category_name: e.category.name,
                  })}
                </strong>
                <br />
                <span className="muted">{e.branch.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/**
        * **The other half of حسابي, named and linked** (2026-09-05).
        *
        * A beneficiary has two account destinations: this framed one, which
        * shows who the association has her as and where she is placed, and
        * `/profile`, which holds the details she may change and the deletion of
        * her account. Neither mentioned the other, so the editable half was
        * reachable only from the header menu — rule P's defect on the one page
        * a person visits *to manage her account*.
        *
        * A link rather than a merge: `/profile` is deliberately outside the
        * portals (R65) because it is reachable whatever role you work as, and
        * duplicating its controls here would be two places to change one name.
        */}
      <section className="card" aria-labelledby="account-personal">
        <h2 id="account-personal">{t('student.account.personalTitle')}</h2>
        <p className="muted">{t('student.account.personalLede')}</p>
        <div className="register-form__actions">
          <ButtonLink variant="secondary" href="/profile">
            {t('student.account.personalAction')}
          </ButtonLink>
        </div>
      </section>
    </StudentLayout>
  );
}
