import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchMyChildApplications, type MyChildApplication } from '../../adapters/child-applications.js';
import { fetchOwnProfile, updateOwnProfile, type OwnProfile } from '../../adapters/profile.js';
import { ApplicationHeader } from '../../components/header/application-header.js';
import { SiteFooter } from '../../components/site-footer.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { Badge } from '../../components/ui/badge.js';
import { Button, ButtonLink } from '../../components/ui/button.js';
import { Container } from '../../components/ui/container.js';
import { TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { UserQr } from '../../components/ui/user-qr.js';

/**
 * `/profile` — **the personal section** (§5.2 *Shared / Cross-Role*, R65).
 *
 * **Role-independent, and that is the whole point.** §5.2 has listed this node
 * since long before the role portals existed, and it was never built — so R64,
 * needing somewhere to put child registration, hung it off `/dashboard/student`.
 * A مؤطِّرة who is nobody's student then had no way to register her own child.
 *
 * What belongs here is what concerns **the person**, not a capacity they are
 * working in: their own details, the part of those details that is theirs to
 * edit, and the children they have asked the association to register.
 *
 * **No account-deletion control**, deliberately. §4.10's *"two-step account
 * self-deletion"* is drafted in `docs/SRS-PROPOSAL-R54.md` and **has never been
 * approved** — it reverses R52's prohibition on permanent deletion. Shipping an
 * irreversible action because a page now exists to host it would be the worst
 * possible reading of this revision.
 */
export function ProfilePage(): ReactNode {
  const { accessToken, status } = useSession();

  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [applications, setApplications] = useState<MyChildApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(false);

  const load = useCallback(async () => {
    if (status !== 'authenticated') return;
    setLoading(true);
    setFailure(false);
    try {
      const [own, mine] = await Promise.all([
        fetchOwnProfile(accessToken),
        // A person's own requests, and nothing else — the endpoint scopes to
        // the caller (R62). Failing this must not blank the whole page, so the
        // two loads share one try and the list is simply empty on error.
        fetchMyChildApplications(accessToken).catch(() => []),
      ]);
      setProfile(own);
      setApplications(mine);
    } catch {
      setFailure(true);
    } finally {
      setLoading(false);
    }
  }, [accessToken, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <ApplicationHeader />
      <main id="main" className="section">
        <Container narrow>
          <h1>{t('profile.title')}</h1>
          <p className="lede">{t('profile.lede')}</p>

          {loading ? (
            <LoadingState />
          ) : failure || !profile ? (
            <ErrorState onRetry={() => void load()} />
          ) : (
            <>
              <ProfileDetails profile={profile} onSaved={setProfile} />
              <ChildSection applications={applications} />
            </>
          )}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The record, and the two fields §5.2 lets a person change themselves.
 *
 * Everything else is rendered **read-only rather than omitted**: a person should
 * see the name and email their account carries — those are the facts staff will
 * use to find them — while a control to change them here would be wrong. A
 * rename is identity and belongs on the §14.2 screen where it is reviewable;
 * `sex` feeds §4.4b's admission rule; the email IS the Google identity.
 */
function ProfileDetails({
  profile,
  onSaved,
}: {
  profile: OwnProfile;
  onSaved: (next: OwnProfile) => void;
}): ReactNode {
  const { accessToken } = useSession();
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [nickname, setNickname] = useState(profile.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const next = await updateOwnProfile(
        // Empty means *cleared*, which is a real answer for an optional field —
        // distinct from "unchanged", which would be omitting the key.
        { phone: phone.trim() === '' ? null : phone.trim(), nickname: nickname.trim() === '' ? null : nickname.trim() },
        profile.version,
        accessToken,
      );
      onSaved(next);
      setNotice(t('profile.saved'));
    } catch (error) {
      // TD-15: somebody else changed the row. Saying so beats "failed", because
      // the reader's next action is to reload rather than retry.
      setNotice(
        error instanceof ApiError && error.code === 'VERSION_CONFLICT'
          ? t('profile.versionConflict')
          : t('profile.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="details-heading">
      <h2 id="details-heading">{t('profile.detailsTitle')}</h2>

      <dl className="detail-list">
        <dt>{t('register.firstNameArabic')} / {t('register.lastNameArabic')}</dt>
        <dd>{profile.name_arabic}</dd>
        {profile.name_french ? (
          <>
            <dt>{t('profile.nameFrench')}</dt>
            <dd>{profile.name_french}</dd>
          </>
        ) : null}
        <dt>{t('admin.users.email')}</dt>
        <dd>{profile.email ?? <span className="muted">{t('common.notSet')}</span>}</dd>
        <dt>{t('admin.users.colStatus')}</dt>
        <dd>
          <Badge tone={profile.account_status === 'active' ? 'ok' : 'warn'}>
            {t(`admin.users.status.${profile.account_status}`)}
          </Badge>
        </dd>
        {profile.reference_code ? (
          <>
            <dt>{t('studentDashboard.referenceCode')}</dt>
            <dd>{profile.reference_code}</dd>
          </>
        ) : null}
      </dl>

      {/* Said rather than left to be discovered: a person who cannot find a way
          to correct their own name should learn why, and where it is done. */}
      <p className="muted">{t('profile.identityReadOnly')}</p>

      {/**
        * **R96 — the account holder's own QR identity.**
        *
        * `/profile` is the person-level surface R65 deliberately placed OUTSIDE
        * the portals, reachable whatever role you are working as — which makes
        * it the one home a مؤطِّرة, an Admin, a Super Admin, a guardian and an
        * adult beneficiary already share. So every one of them reaches their
        * identity here, through the same component, without a portal-shaped copy.
        *
        * **A parent gets HER OWN here, always.** The child's lives on the
        * child's account view under child context; the two are never swapped,
        * because a card printed for the wrong person is worse than no card.
        */}
      <h3>{t('qr.mine')}</h3>
      <p className="muted">{t('qr.lede')}</p>
      <UserQr qr={profile.qr} caption={profile.name_arabic} />

      <TextField label={t('register.phone')} type="tel" value={phone} onChange={setPhone} hint={t('register.phoneHint')} />
      <TextField label={t('register.nickname')} value={nickname} onChange={setNickname} hint={t('register.nicknameHint')} />

      {notice ? (
        <p className="state" role="status">
          {notice}
        </p>
      ) : null}

      <div className="register-form__actions">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </section>
  );
}

/**
 * Registering children, and the status of what was already asked for.
 *
 * **Available to every account** (R65) — a teacher, an administrator, an adult
 * student or a parent. The Parent *role* is about reaching already-approved
 * children; asking for a new one is not a role's act.
 */
function ChildSection({ applications }: { applications: MyChildApplication[] }): ReactNode {
  return (
    <section className="card" aria-labelledby="children-heading">
      <h2 id="children-heading">{t('profile.childrenTitle')}</h2>
      <p className="muted">{t('profile.childrenLede')}</p>

      <div className="register-form__actions">
        <ButtonLink variant="add" href="/profile/register-child">
          {t('child.register')}
        </ButtonLink>
      </div>

      {applications.length === 0 ? null : (
        <ul className="detail-list">
          {applications.map((application) => (
            <li key={application.id}>
              {application.first_name_arabic} {application.last_name_arabic}{' '}
              <Badge tone={application.status === 'approved' ? 'ok' : 'warn'}>
                {t(`profile.childStatus.${application.status}`)}
              </Badge>
              {/* R62.8 — the bounded reason is the ONE thing the applicant is
                  told; `internal_note` is absent from the projection entirely. */}
              {application.rejection_reason ? (
                <span className="muted">
                  {' '}
                  {t(`admin.approvals.childReason_${application.rejection_reason}`)}
                </span>
              ) : null}
              {application.reference_code ? (
                <span className="muted"> · {application.reference_code}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
