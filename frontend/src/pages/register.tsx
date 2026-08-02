import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../adapters/branches.js';
import {
  LIMITS,
  PHONE_PATTERN,
  submitRegistration,
  type PersonInput,
  type RegistrationInput,
} from '../adapters/registrations.js';
import { ConsentNotice } from '../components/consent-notice.js';
import { ErrorState } from '../components/states.js';
import { BranchSelector } from '../components/ui/branch-selector.js';
import { Button } from '../components/ui/button.js';
import { Container } from '../components/ui/container.js';
import { SelectField, TextArea, TextField } from '../components/ui/field.js';
import { t } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';

/**
 * `/register` — the unified registration form (§5.5, §4.1, §4.1b step 5).
 *
 * **Assembled entirely from the shared primitives**: `TextField`, `TextArea`,
 * `SelectField` and `BranchSelector`. No hand-rolled `<input>` anywhere
 * (constitution §4.3), so label association, error announcement, hint wiring
 * and required marking come from `field.tsx` rather than from this file
 * remembering them.
 *
 * **The applicant chooses a Branch, and nothing else organisational (Revision
 * 39).** There is no Level, Room or Group control here and there must not be —
 * those are administrative decisions after approval, and the server rejects
 * them outright rather than dropping them. The branch list comes from the
 * public `GET /branches`, the same endpoint the landing page uses: §4.1 forbids
 * a registration-metadata endpoint that would duplicate reference data behind a
 * public surface, and using the existing one means a branch added in the back
 * office appears here with no frontend change.
 *
 * **The onboarding token is the credential and never leaves the fragment.** It
 * arrives at `#onboarding_token=…` from §4.1b step 4c, is read once, and the
 * fragment is stripped from the address bar so it cannot survive in history or
 * be copied into a shared link. It travels only in `X-Onboarding-Token`.
 *
 * **Validation here mirrors TD-9 for immediate feedback; the server validates
 * for correctness** (§1.1). Reaching this screen without a token is not an
 * error state to style around — it means the OAuth sequence was not completed,
 * so the page says so and offers the way back in.
 */
export function Register(): ReactNode {
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [branchesFailed, setBranchesFailed] = useState(false);

  const [kind, setKind] = useState<'adult' | 'parent_child'>('adult');
  const [applicant, setApplicant] = useState<PersonForm>(emptyPerson);
  const [child, setChild] = useState<PersonForm>(emptyPerson);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [dataProcessing, setDataProcessing] = useState(false);
  const [mediaRelease, setMediaRelease] = useState<'' | 'yes' | 'no'>('');

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [failureId, setFailureId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const fromCallback = hash.get('onboarding_token');
    if (fromCallback) {
      setToken(fromCallback);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setTokenChecked(true);
  }, []);

  const loadBranches = useCallback(async () => {
    setBranchesFailed(false);
    try {
      setBranches(await fetchBranches());
    } catch {
      // The branch is required, so a failed list is a blocking failure rather
      // than a degraded one — offering the form without it would let someone
      // fill everything in and then be unable to submit.
      setBranchesFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  const errors = validate({ kind, applicant, child, branchId, dataProcessing, mediaRelease });
  const valid = Object.keys(errors).length === 0;

  async function submit(): Promise<void> {
    setTouched(true);
    if (!valid || !token) return;
    setBusy(true);
    setFailure(null);
    setFailureId(null);
    try {
      await submitRegistration(buildPayload({ kind, applicant, child, branchId: branchId!, mediaRelease }), token);
      setDone(true);
    } catch (error) {
      setFailure(explainFailure(error));
      // §14.4 wants the request id shown discreetly: it is what turns a user's
      // "it did not work" into a line an operator can find in the log.
      setFailureId(error instanceof ApiError ? error.requestId : null);
    } finally {
      setBusy(false);
    }
  }

  if (!tokenChecked) return null;

  if (done) {
    // §4.1: every registration enters Pending, and the applicant is told
    // exactly that — not "success", which would imply access they do not have.
    return (
      <main className="auth-page" role="status">
        <h1>{t('register.submittedTitle')}</h1>
        <p>{t('register.submittedBody')}</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="auth-page" role="status">
        <h1>{t('register.noTokenTitle')}</h1>
        <p>{t('register.noTokenBody')}</p>
        <a className="button primary" href="/api/v1/auth/google">
          {t('register.startOver')}
        </a>
      </main>
    );
  }

  return (
    <main className="section">
      <Container narrow>
        <h1>{t('register.title')}</h1>
        <p className="lede">{t('register.lede')}</p>

        {branchesFailed ? (
          <ErrorState onRetry={() => void loadBranches()} />
        ) : (
          <form
            className="register-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <SelectField
              label={t('register.kindLabel')}
              value={kind}
              onChange={(next) => setKind(next as 'adult' | 'parent_child')}
              options={[
                { value: 'adult', label: t('register.kindAdult') },
                { value: 'parent_child', label: t('register.kindParentChild') },
              ]}
              hint={t('register.kindHint')}
            />

            <fieldset className="register-form__group">
              <legend>{kind === 'adult' ? t('register.you') : t('register.parent')}</legend>
              <PersonFields
                value={applicant}
                onChange={setApplicant}
                errors={touched ? errors : {}}
                prefix="applicant"
              />
            </fieldset>

            {kind === 'parent_child' ? (
              <fieldset className="register-form__group">
                <legend>{t('register.child')}</legend>
                <PersonFields
                  value={child}
                  onChange={setChild}
                  errors={touched ? errors : {}}
                  prefix="child"
                />
              </fieldset>
            ) : null}

            <fieldset className="register-form__group">
              <legend>{t('register.branchLegend')}</legend>
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
            </fieldset>

            <fieldset className="register-form__group">
              <legend>{t('register.consentLegend')}</legend>

              {/* A checkbox, not a select: it is a single agreement, and §4.1
                  requires the decision be recorded as a ConsentRecord either
                  way — which is why the media release below is a THREE-state
                  control rather than an unchecked box.

                  The statute is explained on demand rather than merely cited,
                  because consent that is not informed is not consent. */}
              <ConsentNotice
                checked={dataProcessing}
                onChange={setDataProcessing}
                error={touched ? (errors['dataProcessing'] ?? null) : null}
              />

              {kind === 'parent_child' ? (
                <SelectField
                  label={t('register.consentMedia')}
                  value={mediaRelease}
                  onChange={(next) => setMediaRelease(next as '' | 'yes' | 'no')}
                  placeholder={t('register.consentMediaChoose')}
                  options={[
                    { value: 'yes', label: t('common.yes') },
                    { value: 'no', label: t('common.no') },
                  ]}
                  required
                  // Declining is a real, recorded decision — never an omission.
                  // BR-1 treats an absent record as refusal, so "no" and
                  // "unanswered" must be different answers here.
                  hint={t('register.consentMediaHint')}
                  error={touched ? (errors['mediaRelease'] ?? null) : null}
                />
              ) : null}
            </fieldset>

            {failure ? (
              <p className="field__error" role="alert">
                {failure}
                {failureId ? <span className="field__requestid"> ({failureId})</span> : null}
              </p>
            ) : null}

            <div className="register-form__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t('common.saving') : t('register.submit')}
              </Button>
            </div>
          </form>
        )}
      </Container>
    </main>
  );
}

/* ── The person sub-form, used for applicant and child alike ──────────────── */

interface PersonForm {
  firstNameArabic: string;
  lastNameArabic: string;
  nameFrench: string;
  nickname: string;
  phone: string;
  notes: string;
  sex: '' | 'female' | 'male';
}

const emptyPerson: PersonForm = {
  firstNameArabic: '',
  lastNameArabic: '',
  nameFrench: '',
  nickname: '',
  phone: '',
  notes: '',
  sex: '',
};

/**
 * One component for both people (§2.1 — one component per *concept*). A
 * `ParentFields` and a `ChildFields` would have been two copies of the same
 * five inputs, and the second would have drifted.
 */
function PersonFields({
  value,
  onChange,
  errors,
  prefix,
}: {
  value: PersonForm;
  onChange: (next: PersonForm) => void;
  errors: Record<string, string>;
  prefix: 'applicant' | 'child';
}): ReactNode {
  const set = (patch: Partial<PersonForm>) => onChange({ ...value, ...patch });

  return (
    <>
      {/* Revision 40 — الاسم الشخصي and الاسم العائلي, matching how Moroccan
          administrative records read. Two shared `TextField`s, not a new
          component: the concept is "a text field", and the form composes. */}
      <TextField
        label={t('register.firstNameArabic')}
        value={value.firstNameArabic}
        onChange={(next) => set({ firstNameArabic: next })}
        required
        error={errors[`${prefix}.firstNameArabic`] ?? null}
      />
      <TextField
        label={t('register.lastNameArabic')}
        value={value.lastNameArabic}
        onChange={(next) => set({ lastNameArabic: next })}
        required
        error={errors[`${prefix}.lastNameArabic`] ?? null}
      />
      <SelectField
        label={t('register.sex')}
        value={value.sex}
        onChange={(next) => set({ sex: next as PersonForm['sex'] })}
        placeholder={t('common.choose')}
        options={[
          { value: 'female', label: t('register.sexFemale') },
          { value: 'male', label: t('register.sexMale') },
        ]}
        required
        error={errors[`${prefix}.sex`] ?? null}
      />
      <TextField
        label={t('register.nameFrench')}
        value={value.nameFrench}
        onChange={(next) => set({ nameFrench: next })}
      />
      <TextField
        label={t('register.nickname')}
        value={value.nickname}
        onChange={(next) => set({ nickname: next })}
        hint={t('register.nicknameHint')}
      />
      <TextField
        label={t('register.phone')}
        type="tel"
        value={value.phone}
        onChange={(next) => set({ phone: next })}
        hint={t('register.phoneHint')}
        error={errors[`${prefix}.phone`] ?? null}
      />
      <TextArea
        label={t('register.notes')}
        value={value.notes}
        onChange={(next) => set({ notes: next })}
        rows={3}
      />
    </>
  );
}

/* ── Turning a failure into something the reader can act on ───────────────── */

/**
 * §14.4: an error states what went wrong and, where the cause is known, what to
 * do about it.
 *
 * **This function exists because of a P0.** Submitting returned *"try again
 * later"* while the server was saying something precise and actionable —
 * `SERVICE_UNAVAILABLE` with `details.reason = CONSENT_TEXT_VERSION_NOT_CONFIGURED`,
 * meaning a `SystemSetting` row the platform requires had never been written.
 * "Try again later" was not merely unhelpful, it was **wrong**: no amount of
 * waiting would have fixed it, and it sent the reader away from the one action
 * that would.
 *
 * The rule this encodes: **branch on the server's `code` and `details` first,
 * and fall back to a generic message only when the cause is genuinely unknown.**
 */
export function explainFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return t('register.failed');

  const reason = error.details['reason'];

  // A configuration gap, not a transient outage. Naming it is what lets an
  // operator fix it in one step instead of reading logs.
  if (reason === 'CONSENT_TEXT_VERSION_NOT_CONFIGURED') {
    return t('register.consentVersionMissing');
  }

  switch (error.code) {
    case 'CONSENT_REQUIRED':
      return t('register.errConsent');
    case 'VALIDATION_FAILED':
      return t('register.rejected');
    // The onboarding token is single-use and short-lived (§4.1b). A replay or an
    // expiry is not "try again" — it is "start the sign-in again", and saying so
    // is the difference between a fixable dead end and a mysterious one.
    case 'STATE_CONFLICT':
    case 'DUPLICATE':
    case 'AUTH_REQUIRED':
      return t('register.tokenSpent');
    default:
      break;
  }

  // No envelope (a gateway error page, a dropped connection): fall back on the
  // status, which is all there is.
  if (error.status === 401 || error.status === 409) return t('register.tokenSpent');
  if (error.status === 400) return t('register.rejected');
  return t('register.failed');
}

/* ── Validation, mirroring TD-9 ───────────────────────────────────────────── */

interface FormState {
  kind: 'adult' | 'parent_child';
  applicant: PersonForm;
  child: PersonForm;
  branchId: string | null;
  dataProcessing: boolean;
  mediaRelease: '' | 'yes' | 'no';
}

export function validate(state: FormState): Record<string, string> {
  const errors: Record<string, string> = {};

  const person = (p: PersonForm, prefix: string) => {
    // Both parts are required and each is capped separately (TD-9, R40) — the
    // per-part limit is what keeps the composed name inside its column.
    for (const part of ['firstNameArabic', 'lastNameArabic'] as const) {
      const raw = p[part].trim();
      if (raw === '') errors[`${prefix}.${part}`] = t('register.errRequired');
      else if (raw.length > LIMITS.namePart) errors[`${prefix}.${part}`] = t('register.errTooLong');
    }
    if (p.sex === '') errors[`${prefix}.sex`] = t('register.errRequired');
    const phone = p.phone.trim();
    if (phone !== '' && (!PHONE_PATTERN.test(phone) || phone.length < LIMITS.phoneMin || phone.length > LIMITS.phoneMax))
      errors[`${prefix}.phone`] = t('register.errPhone');
  };

  person(state.applicant, 'applicant');
  if (state.kind === 'parent_child') person(state.child, 'child');

  // §4.1 Revision 39 — a choice, never a default. Defaulting would place
  // someone at a branch nobody picked.
  if (!state.branchId) errors['branch'] = t('register.errBranch');

  // §4.1: there is no lawful basis to create the record without this, so it is
  // refused rather than warned about.
  if (!state.dataProcessing) errors['dataProcessing'] = t('register.errConsent');

  // A DECISION is required for a minor; "no" is a valid one (BR-1).
  if (state.kind === 'parent_child' && state.mediaRelease === '')
    errors['mediaRelease'] = t('register.errMediaDecision');

  return errors;
}

function buildPayload(state: {
  kind: 'adult' | 'parent_child';
  applicant: PersonForm;
  child: PersonForm;
  branchId: string;
  mediaRelease: '' | 'yes' | 'no';
}): RegistrationInput {
  const person = (p: PersonForm): PersonInput => ({
    // The parts only — the server composes `name_arabic` (§1.1, R40), and
    // sending it would be rejected rather than ignored.
    first_name_arabic: p.firstNameArabic.trim(),
    last_name_arabic: p.lastNameArabic.trim(),
    sex: p.sex as 'female' | 'male',
    // Optional fields are OMITTED rather than sent empty: the server's schema
    // caps their length, and an empty string is a value where absence is meant.
    ...(p.nameFrench.trim() ? { name_french: p.nameFrench.trim() } : {}),
    ...(p.nickname.trim() ? { nickname: p.nickname.trim() } : {}),
    ...(p.phone.trim() ? { phone: p.phone.trim() } : {}),
    ...(p.notes.trim() ? { notes: p.notes.trim() } : {}),
  });

  if (state.kind === 'adult') {
    return {
      kind: 'adult',
      applicant: person(state.applicant),
      branch_id: state.branchId,
      consents: { data_processing: true },
    };
  }
  return {
    kind: 'parent_child',
    parent: person(state.applicant),
    child: person(state.child),
    branch_id: state.branchId,
    consents: { data_processing: true, media_release: state.mediaRelease === 'yes' },
  };
}
