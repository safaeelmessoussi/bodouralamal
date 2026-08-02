import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../adapters/branches.js';
import {
  LIMITS,
  PHONE_PATTERN,
  submitRegistration,
  type PersonInput,
  type RegistrationInput,
} from '../adapters/registrations.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
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
  const [serverErrors, setServerErrors] = useState<ServerErrors>({ fields: {}, unmapped: [] });
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

  const localErrors = validate({ kind, applicant, child, branchId, dataProcessing, mediaRelease });
  const valid = Object.keys(localErrors).length === 0;
  // The server's verdict wins where the two disagree: it is the authority
  // (§1.1), and a field the client thought fine but the server refused must
  // still be marked.
  const errors = { ...localErrors, ...serverErrors.fields };

  async function submit(): Promise<void> {
    setTouched(true);
    if (!valid || !token) return;
    setBusy(true);
    setFailure(null);
    setFailureId(null);
    setServerErrors({ fields: {}, unmapped: [] });
    try {
      await submitRegistration(buildPayload({ kind, applicant, child, branchId: branchId!, mediaRelease }), token);
      setDone(true);
    } catch (error) {
      // Field-level first: the server said WHICH field, and the whole point is
      // that the applicant should not have to guess.
      setServerErrors(mapServerIssues(error));
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
    // The header goes on this page too. It used to be a dead end: an applicant
    // who had just submitted had no way back to the site at all — no home, no
    // sign-in, nothing. Reusing the public header rather than inventing links
    // means it carries whatever navigation the rest of the site carries.
    return (
      <>
        <ApplicationHeader />
        <main id="main" className="auth-page" role="status">
          <h1>{t('register.submittedTitle')}</h1>
          <p>{t('register.submittedBody')}</p>
          <p className="muted">{t('register.submittedNext')}</p>
          <div className="auth-page__links">
            <a className="button primary" href="/">
              {t('nav.home')}
            </a>
            <a className="button secondary" href="/login">
              {t('nav.login')}
            </a>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (!token) {
    return (
      <>
        <ApplicationHeader />
        <main id="main" className="auth-page" role="status">
          <h1>{t('register.noTokenTitle')}</h1>
          <p>{t('register.noTokenBody')}</p>
          <div className="auth-page__links">
            <a className="button primary" href="/api/v1/auth/google">
              {t('register.startOver')}
            </a>
            <a className="button secondary" href="/">
              {t('nav.home')}
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
              <div role="alert">
                <p className="field__error">
                  {failure}
                  {failureId ? <span className="field__requestid"> ({failureId})</span> : null}
                </p>
                {/* Issues this form could not place on a field. Shown verbatim
                    rather than dropped: an unanticipated message is precisely
                    the one worth reading, and dropping it is how a stale client
                    talking to a newer server looked like "review the fields". */}
                {serverErrors.unmapped.length > 0 ? (
                  <ul className="field__error">
                    {serverErrors.unmapped.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
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
      <SiteFooter />
    </>
  );
}

/* ── The person sub-form, used for applicant and child alike ──────────────── */

interface PersonForm {
  firstNameArabic: string;
  lastNameArabic: string;
  firstNameFrench: string;
  lastNameFrench: string;
  nickname: string;
  phone: string;
  notes: string;
  sex: '' | 'female' | 'male';
}

const emptyPerson: PersonForm = {
  firstNameArabic: '',
  lastNameArabic: '',
  firstNameFrench: '',
  lastNameFrench: '',
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
      {/* Revision 41 — split like the Arabic pair, so a person's name is not
          half two fields and half one. Optional as a PAIR: both or neither. */}
      <TextField
        label={t('register.firstNameFrench')}
        value={value.firstNameFrench}
        onChange={(next) => set({ firstNameFrench: next })}
        error={errors[`${prefix}.firstNameFrench`] ?? null}
      />
      <TextField
        label={t('register.lastNameFrench')}
        value={value.lastNameFrench}
        onChange={(next) => set({ lastNameFrench: next })}
        error={errors[`${prefix}.lastNameFrench`] ?? null}
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
 * Maps the server's Zod issue paths onto this form's field keys.
 *
 * **The backend has always sent `details.issues` with an exact `path` per
 * failure** — `applicant.first_name_arabic`, `child.last_name_french`,
 * `branch_id`. The form threw all of it away and rendered one sentence, so a
 * rejected submission said *"review the fields"* without saying which, and an
 * applicant had to guess.
 *
 * The **path** is used rather than the message text: it is machine-readable and
 * stable, whereas Zod's message is English prose written for a developer
 * ("Invalid input: expected string, received undefined"). Showing that to an
 * Arabic-speaking applicant would be worse than showing nothing. So a known
 * path becomes our own Arabic message on the right field; an *unknown* path
 * keeps the server's own text, because swallowing a message we failed to
 * anticipate is how this defect happened in the first place.
 */
const SERVER_FIELD_PATHS: Record<string, string> = {
  first_name_arabic: 'firstNameArabic',
  last_name_arabic: 'lastNameArabic',
  first_name_french: 'firstNameFrench',
  last_name_french: 'lastNameFrench',
  nickname: 'nickname',
  phone: 'phone',
  notes: 'notes',
  sex: 'sex',
};

export interface ServerErrors {
  /** Keyed exactly like `validate`'s output, so the two merge. */
  fields: Record<string, string>;
  /** Issues whose path this form does not recognise — surfaced, never dropped. */
  unmapped: string[];
}

export function mapServerIssues(error: unknown): ServerErrors {
  const empty: ServerErrors = { fields: {}, unmapped: [] };
  if (!(error instanceof ApiError)) return empty;

  const raw = error.details['issues'];
  if (!Array.isArray(raw)) return empty;

  const fields: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const issue of raw as { path?: unknown; message?: unknown }[]) {
    const path = typeof issue.path === 'string' ? issue.path : '';
    const message = typeof issue.message === 'string' ? issue.message : '';

    // `applicant.first_name_arabic` → person `applicant`, field `first_name_arabic`.
    const [head, tail] = path.includes('.') ? path.split('.', 2) : ['', path];
    const person = head === 'parent' ? 'applicant' : head; // the form calls the parent "applicant"

    if (tail && SERVER_FIELD_PATHS[tail] && (person === 'applicant' || person === 'child')) {
      fields[`${person}.${SERVER_FIELD_PATHS[tail]}`] = t('register.errServerField');
      continue;
    }
    if (path === 'branch_id') {
      fields['branch'] = t('register.errBranch');
      continue;
    }
    if (path.startsWith('consents')) {
      fields['dataProcessing'] = t('register.errConsent');
      continue;
    }
    // Anything this form has not anticipated — including an `Unrecognized key`
    // for a field it should not have sent at all, which is exactly the signal
    // that a stale client is talking to a newer server.
    if (message) unmapped.push(`${path ? `${path}: ` : ''}${message}`);
  }

  return { fields, unmapped };
}



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
    // R41: both French parts or neither. Half a name is not a name, and the
    // server refuses it — so the form says which half is missing rather than
    // letting the applicant discover it on submit.
    const fr = p.firstNameFrench.trim();
    const lr = p.lastNameFrench.trim();
    if (fr !== '' && lr === '') errors[`${prefix}.lastNameFrench`] = t('register.errFrenchPair');
    if (lr !== '' && fr === '') errors[`${prefix}.firstNameFrench`] = t('register.errFrenchPair');
    for (const [part, raw] of [['firstNameFrench', fr], ['lastNameFrench', lr]] as const) {
      if (raw.length > LIMITS.namePart) errors[`${prefix}.${part}`] = t('register.errTooLong');
    }

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
    ...(p.firstNameFrench.trim() && p.lastNameFrench.trim()
      ? {
          first_name_french: p.firstNameFrench.trim(),
          last_name_french: p.lastNameFrench.trim(),
        }
      : {}),
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
