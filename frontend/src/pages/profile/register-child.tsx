import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../../adapters/branches.js';
import { fetchCalendarBootstrap, type CategoryRef } from '../../adapters/calendar.js';
import { submitChildApplications } from '../../adapters/child-applications.js';
import { LIMITS, type ChildInput } from '../../adapters/registrations.js';
import { ApplicationHeader } from '../../components/header/application-header.js';
import { SiteFooter } from '../../components/site-footer.js';
import { ConsentNotice } from '../../components/consent-notice.js';
import { ErrorState } from '../../components/states.js';
import { BranchSelector } from '../../components/ui/branch-selector.js';
import { Button } from '../../components/ui/button.js';
import { Container } from '../../components/ui/container.js';
import { SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/profile/register-child` — **any account** registers a child (§14.1, R65).
 *
 * **Two moves, each correcting the one before it.** R62 put «＋ تسجيل طفل»
 * inside the account switcher's `ولي الأمر` group; R64 made it a page, but hung
 * it off `/dashboard/student/` — a *role's* area. Both were wrong for the same
 * reason, and the Owner's case names it exactly: **a مؤطِّرة who is nobody's
 * student must be able to register her own child.** Registering is an act of a
 * person, so it lives in the personal section, which §5.2 has listed under
 * *Shared / Cross-Role* since long before any of this.
 *
 * **This changes no authorization.** `POST /child-applications` has always
 * required only an authenticated active account — `submitChildApplications`
 * performs no role check by design — so the teacher could always have called
 * it. The interface simply gave her nowhere to do it.
 *
 * **One entry point, not one per role**, and that is what keeps the field set
 * from diverging again: R64 exists because a dialog reachable only by parents
 * carried less than the public form, and an approver received requests naming
 * no branch and no stage.
 *
 * **So this page asks what `/register`'s child section asks, and nothing more:**
 * the two Arabic name parts, sex, the optional French pair, a nickname, the
 * schooling stage, **المقر المطلوب**, **الفئة**, and the two consents. The field
 * set is the server's `childCore` schema plus the request-level branch and
 * category — no phone and no free-text notes, because R62.1 declares those are
 * not collected about a minor and the server rejects them outright.
 *
 * **Available to any adult account**, not only to parents: a parent adding a
 * second child and an adult student registering one are the same act, which is
 * why `POST /child-applications` accepts both.
 *
 * **One child per submission, deliberately.** The endpoint takes up to twelve
 * and `/register` uses that, because a family arrives at once; a person already
 * on the platform is adding one, and a repeatable section here would be a second
 * multi-child form to keep in step with the first.
 */
const SCHOOLING_STAGES: NonNullable<ChildInput['schooling_stage']>[] = [
  'pre_primary',
  'primary',
  'middle',
  'high',
  'post_secondary',
  'not_in_school',
];

interface ChildForm {
  firstNameArabic: string;
  lastNameArabic: string;
  firstNameFrench: string;
  lastNameFrench: string;
  nickname: string;
  sex: '' | 'female' | 'male';
  schoolingStage: '' | NonNullable<ChildInput['schooling_stage']>;
  mediaRelease: '' | 'yes' | 'no';
}

const EMPTY: ChildForm = {
  firstNameArabic: '',
  lastNameArabic: '',
  firstNameFrench: '',
  lastNameFrench: '',
  nickname: '',
  sex: '',
  schoolingStage: '',
  mediaRelease: '',
};

export function RegisterChildPage(): ReactNode {
  const { accessToken } = useSession();

  const [form, setForm] = useState<ChildForm>(EMPTY);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dataProcessing, setDataProcessing] = useState(false);

  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [referenceFailed, setReferenceFailed] = useState(false);

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (patch: Partial<ChildForm>) => setForm((current) => ({ ...current, ...patch }));

  const loadReference = useCallback(async () => {
    setReferenceFailed(false);
    try {
      // The same two public sources `/register` uses, for the same reason
      // (§4.1, Revision 29): a branch or a stage added in the back office
      // appears here with no frontend change, and neither is duplicated behind
      // a registration-specific endpoint.
      const today = new Date().toISOString().slice(0, 10);
      const [live, bootstrap] = await Promise.all([
        fetchBranches(),
        fetchCalendarBootstrap({ from: today, to: today }),
      ]);
      setBranches(live);
      setCategories(bootstrap.categories);
    } catch {
      // Both are required, so a failed load blocks rather than degrades —
      // offering the form would let someone fill it in and fail at submit.
      setReferenceFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadReference();
  }, [loadReference]);

  const errors = validate(form, branchId, categoryId, dataProcessing);
  const valid = Object.keys(errors).length === 0;

  async function submit(): Promise<void> {
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setFailure(null);
    try {
      await submitChildApplications(
        [
          {
            first_name_arabic: form.firstNameArabic.trim(),
            last_name_arabic: form.lastNameArabic.trim(),
            sex: form.sex as 'female' | 'male',
            ...(form.firstNameFrench.trim() && form.lastNameFrench.trim()
              ? {
                  first_name_french: form.firstNameFrench.trim(),
                  last_name_french: form.lastNameFrench.trim(),
                }
              : {}),
            ...(form.nickname.trim() ? { nickname: form.nickname.trim() } : {}),
            ...(form.schoolingStage ? { schooling_stage: form.schoolingStage } : {}),
            requested_branch_id: branchId!,
            requested_category_id: categoryId!,
            consent_media_release: form.mediaRelease === 'yes',
          },
        ],
        accessToken,
      );
      setDone(true);
    } catch (error) {
      // The server's own reason where it gave one: a missing consent text
      // version is a configuration gap an operator fixes in one step, and "try
      // again" would send the reader away from the only action that helps.
      setFailure(
        error instanceof ApiError && error.details['reason'] === 'CONSENT_TEXT_VERSION_MISSING'
          ? t('register.consentVersionMissing')
          : t('child.registerFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <ApplicationHeader />
        <main id="main" className="auth-page" role="status">
          <h1>{t('child.registerSubmittedTitle')}</h1>
          {/* §4.1: the request enters Pending and the reader is told exactly
              that — never "success", which would imply a child they can already
              act for. */}
          <p>{t('child.registerSubmitted')}</p>
          <div className="auth-page__links">
            <a className="button primary" href="/profile">
              {t('child.backToProfile')}
            </a>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <ApplicationHeader />
      <main id="main" className="section">
        <Container narrow>
          <h1>{t('child.registerTitle')}</h1>
          <p className="lede">{t('child.registerLede')}</p>

          {referenceFailed ? (
            <ErrorState onRetry={() => void loadReference()} />
          ) : (
            <form
              className="register-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <fieldset className="register-form__group">
                <legend>{t('register.child')}</legend>
                <TextField
                  label={t('register.firstNameArabic')}
                  value={form.firstNameArabic}
                  onChange={(next) => set({ firstNameArabic: next })}
                  required
                  error={touched ? (errors['firstNameArabic'] ?? null) : null}
                />
                <TextField
                  label={t('register.lastNameArabic')}
                  value={form.lastNameArabic}
                  onChange={(next) => set({ lastNameArabic: next })}
                  required
                  error={touched ? (errors['lastNameArabic'] ?? null) : null}
                />
                <SelectField
                  label={t('register.sex')}
                  value={form.sex}
                  onChange={(next) => set({ sex: next as ChildForm['sex'] })}
                  placeholder={t('common.choose')}
                  options={[
                    { value: 'female', label: t('register.sexFemale') },
                    { value: 'male', label: t('register.sexMale') },
                  ]}
                  required
                  error={touched ? (errors['sex'] ?? null) : null}
                />
                {/* R41 — optional as a PAIR: both or neither. */}
                <TextField
                  label={t('register.firstNameFrench')}
                  value={form.firstNameFrench}
                  onChange={(next) => set({ firstNameFrench: next })}
                  error={touched ? (errors['firstNameFrench'] ?? null) : null}
                />
                <TextField
                  label={t('register.lastNameFrench')}
                  value={form.lastNameFrench}
                  onChange={(next) => set({ lastNameFrench: next })}
                  error={touched ? (errors['lastNameFrench'] ?? null) : null}
                />
                <TextField
                  label={t('register.nickname')}
                  value={form.nickname}
                  onChange={(next) => set({ nickname: next })}
                  hint={t('register.nicknameHint')}
                />
                {/* R62.7 — informs the placement decision; never makes it. */}
                <SelectField
                  label={t('register.schoolingStage')}
                  value={form.schoolingStage}
                  onChange={(next) => set({ schoolingStage: next as ChildForm['schoolingStage'] })}
                  placeholder={t('register.schoolingStageChoose')}
                  options={SCHOOLING_STAGES.map((stage) => ({
                    value: stage,
                    label: t(`register.schoolingStage_${stage}`),
                  }))}
                  hint={t('register.schoolingStageHint')}
                />
              </fieldset>

              <fieldset className="register-form__group">
                <legend>{t('register.branchLegend')}</legend>
                {/* R64 — the two the public form asks and this one used not to. */}
                <BranchSelector
                  branches={branches}
                  value={branchId}
                  onChange={setBranchId}
                  label={t('register.branchLabel')}
                  allowAll={false}
                  emptyLabel={t('register.branchEmpty')}
                  required
                  hint={t('register.branchHint')}
                  error={touched ? (errors['branch'] ?? null) : null}
                />
                <SelectField
                  label={t('register.categoryLabel')}
                  value={categoryId ?? ''}
                  onChange={(value) => setCategoryId(value === '' ? null : value)}
                  required
                  options={[
                    { value: '', label: t('register.categoryEmpty') },
                    ...categories.map((category) => ({ value: category.id, label: category.name })),
                  ]}
                  hint={t('register.categoryHint')}
                  error={touched ? (errors['category'] ?? null) : null}
                />
              </fieldset>

              <fieldset className="register-form__group">
                <legend>{t('register.consentLegend')}</legend>
                <ConsentNotice
                  checked={dataProcessing}
                  onChange={setDataProcessing}
                  error={touched ? (errors['dataProcessing'] ?? null) : null}
                />
                <SelectField
                  label={t('register.consentMedia')}
                  value={form.mediaRelease}
                  onChange={(next) => set({ mediaRelease: next as ChildForm['mediaRelease'] })}
                  placeholder={t('register.consentMediaChoose')}
                  options={[
                    { value: 'yes', label: t('common.yes') },
                    { value: 'no', label: t('common.no') },
                  ]}
                  required
                  hint={t('register.consentMediaHint')}
                  error={touched ? (errors['mediaRelease'] ?? null) : null}
                />
              </fieldset>

              {failure ? (
                <p className="field__error" role="alert">
                  {failure}
                </p>
              ) : null}

              <div className="register-form__actions">
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? t('common.saving') : t('child.registerSubmit')}
                </Button>
              </div>
            </form>
          )}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The same rules `/register`'s child section applies, stated once here because
 * the two forms submit to two endpoints with one schema behind them (§1.1 — the
 * server is still the authority; this is for immediate feedback).
 */
export function validate(
  form: ChildForm,
  branchId: string | null,
  categoryId: string | null,
  dataProcessing: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const part of ['firstNameArabic', 'lastNameArabic'] as const) {
    const raw = form[part].trim();
    if (raw === '') errors[part] = t('register.errRequired');
    else if (raw.length > LIMITS.namePart) errors[part] = t('register.errTooLong');
  }
  if (form.sex === '') errors['sex'] = t('register.errRequired');

  // R41: both French parts or neither — half a name is not a name, and the
  // server refuses it, so the form says which half is missing.
  const first = form.firstNameFrench.trim();
  const last = form.lastNameFrench.trim();
  if (first !== '' && last === '') errors['lastNameFrench'] = t('register.errFrenchPair');
  if (last !== '' && first === '') errors['firstNameFrench'] = t('register.errFrenchPair');

  // R39/R64 — a choice, never a default: defaulting would ask for a branch
  // nobody picked.
  if (!branchId) errors['branch'] = t('register.errBranch');
  if (!categoryId) errors['category'] = t('register.errCategory');

  // §4.1a — no lawful basis without it, so it is refused rather than warned about.
  if (!dataProcessing) errors['dataProcessing'] = t('register.errConsent');
  // A DECISION is required for a minor; "no" is a valid one (BR-1).
  if (form.mediaRelease === '') errors['mediaRelease'] = t('register.errMediaDecision');

  return errors;
}
