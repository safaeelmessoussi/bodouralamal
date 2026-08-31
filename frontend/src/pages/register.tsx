import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckboxField, SelectField } from '../components/ui/field.js';
import { MultiSelectField } from '../components/ui/multi-select.js';

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
import { fetchCalendarBootstrap, type CategoryRef } from '../adapters/calendar.js';
import { Button, ButtonLink } from '../components/ui/button.js';
import { Container } from '../components/ui/container.js';
import {
  ChildrenFieldset,
  EMPTY_CHILD,
  toChildInput,
  validateChildren,
  type ChildForm,
} from '../components/registration/children.js';
import { PersonFields } from '../components/registration/person-fields.js';
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
  /** Live Categories, ordered by `display_order` — read from the PUBLIC
   *  calendar bootstrap, which already publishes exactly that list. */
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [branchesFailed, setBranchesFailed] = useState(false);

  /**
   * What the visitor is here to do — a **form-level** choice with three options
   * (Revision 49), which maps to only the two payload `kind`s §4.1b step 4c
   * defines.
   *
   * A teacher applying *is* an adult registering themselves; the only
   * difference is what they ask to become. Adding a third `kind` to the wire
   * would have duplicated every name, consent and branch rule for an identical
   * form, and invented a flow the SRS does not describe.
   */
  const [intent, setIntent] = useState<'adult' | 'parent_child' | 'teacher'>('adult');
  const kind: 'adult' | 'parent_child' = intent === 'parent_child' ? 'parent_child' : 'adult';
  const [applicant, setApplicant] = useState<PersonForm>(emptyPerson);
  /**
   * R62.1 — one request carries **one or more** children. The array starts with
   * one so the form looks exactly as it did for the common case; a parent of
   * three no longer submits three registrations and no longer has the whole
   * family approved or rejected as a block.
   */
  const [children, setChildren] = useState<ChildForm[]>([EMPTY_CHILD]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [framingMode, setFramingMode] = useState<'' | 'in_person' | 'online' | 'both'>('');
  const [allFramingBranches, setAllFramingBranches] = useState(false);
  const [framingBranchIds, setFramingBranchIds] = useState<string[]>([]);
  const [dataProcessing, setDataProcessing] = useState(false);

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
      // **The public calendar bootstrap, not a new endpoint.** It already
      // publishes every live Category ordered by `display_order`, anonymously
      // and cached — which is exactly this control's need. This is not the
      // widening rejected for the admin selectors: nothing is added to that
      // payload, a second public surface is reading the fields it already has.
      const today = new Date().toISOString().slice(0, 10);
      const bootstrap = await fetchCalendarBootstrap({ from: today, to: today });
      setCategories(bootstrap.categories);
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

  const localErrors = validate({
    intent,
    applicant,
    children,
    branchId,
    categoryId,
    framingMode,
    allFramingBranches,
    framingBranchIds,
    dataProcessing,
  });
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
      await submitRegistration(
        buildPayload({
          intent,
          applicant,
          children,
          branchId,
          categoryId,
          framingMode,
          allFramingBranches,
          framingBranchIds,
        }),
        token,
      );
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
            <ButtonLink variant="primary" href="/">
              {t('nav.home')}
            </ButtonLink>
            <ButtonLink variant="secondary" href="/login">
              {t('nav.login')}
            </ButtonLink>
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
            <ButtonLink variant="primary" href="/api/v1/auth/google">
              {t('register.startOver')}
            </ButtonLink>
            <ButtonLink variant="secondary" href="/">
              {t('nav.home')}
            </ButtonLink>
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
              value={intent}
              onChange={(next) => {
                const chosen = next as typeof intent;
                setIntent(chosen);
                if (chosen === 'teacher') {
                  // The teacher path has no single requested branch or stage.
                  setBranchId(null);
                  setCategoryId(null);
                } else {
                  // Hidden framing values are erased immediately, not trusted
                  // to a later payload builder to remember to omit them.
                  setFramingMode('');
                  setAllFramingBranches(false);
                  setFramingBranchIds([]);
                }
              }}
              options={[
                { value: 'adult', label: t('register.kindAdult') },
                { value: 'parent_child', label: t('register.kindParentChild') },
                { value: 'teacher', label: t('register.kindTeacher') },
              ]}
              hint={t('register.kindHint')}
            />

            {intent === 'teacher' ? (
              // Said plainly rather than implied: submitting this asks for
              // something a person has to grant. An applicant who expects to be
              // teaching tomorrow has misunderstood the form, and the form is
              // where that is cheapest to correct.
              <p className="state" role="status">
                {t('register.teacherNotice')}
              </p>
            ) : null}

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
              /* R65 — the SHARED section. `/profile/register-child` renders the
                 same one, so the two flows cannot drift again: they lost the
                 repeatable behaviour once already, and a parent of three was
                 submitting three requests from the personal page while this
                 form took them in one. */
              <ChildrenFieldset
                children={children}
                onChange={setChildren}
                errors={errors}
                touched={touched}
                branches={branches}
                categories={categories}
              />
            ) : null}

            {/* R67 — the ADULT path only. On the parent+child path both
                questions are per child now, and the applicant's own branch is
                derived from the first child's server-side: a parent enrols in
                nothing, and asking twice would produce two answers that must
                agree. */}
            {intent === 'teacher' ? (
              <fieldset className="register-form__group">
                <legend>{t('register.framingLegend')}</legend>
                <SelectField
                  label={t('register.framingModeLabel')}
                  value={framingMode}
                  onChange={(next) => {
                    const mode = next as typeof framingMode;
                    setFramingMode(mode);
                    if (mode === 'online' || mode === '') {
                      setAllFramingBranches(false);
                      setFramingBranchIds([]);
                    }
                  }}
                  required
                  options={[
                    { value: '', label: t('register.framingModeEmpty') },
                    { value: 'in_person', label: t('register.framingMode_in_person') },
                    { value: 'online', label: t('register.framingMode_online') },
                    { value: 'both', label: t('register.framingMode_both') },
                  ]}
                  hint={t('register.framingModeHint')}
                  error={touched ? (errors['framingMode'] ?? null) : null}
                />

                {framingMode === 'in_person' || framingMode === 'both' ? (
                  <>
                    <CheckboxField
                      label={t('register.framingAllBranches')}
                      checked={allFramingBranches}
                      onChange={(checked) => {
                        setAllFramingBranches(checked);
                        if (checked) setFramingBranchIds([]);
                      }}
                      hint={t('register.framingAllBranchesHint')}
                    />
                    {allFramingBranches ? null : (
                      <MultiSelectField
                        label={t('register.framingBranchesLabel')}
                        options={branches.map((branch) => ({
                          value: branch.id,
                          label: branch.name,
                        }))}
                        selected={framingBranchIds}
                        onChange={setFramingBranchIds}
                        required
                        hint={t('register.framingBranchesHint')}
                        emptyLabel={t('register.framingBranchesEmpty')}
                        error={touched ? (errors['framingBranches'] ?? null) : null}
                      />
                    )}
                  </>
                ) : null}
              </fieldset>
            ) : kind === 'parent_child' ? null : (
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

                <SelectField
                  label={t('register.categoryLabel')}
                  value={categoryId ?? ''}
                  onChange={(v) => setCategoryId(v === '' ? null : v)}
                  required
                  options={[
                    { value: '', label: t('register.categoryEmpty') },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  hint={t('register.categoryHint')}
                  error={touched ? (errors['category'] ?? null) : null}
                />
              </fieldset>
            )}

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

              {/* R62.3b moved the media release **into each child's own
                  fieldset**: a parent may permit photographs of one child and
                  refuse for another, and one control for the family could not
                  express that. It is no longer here. */}
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
 * A child on the form (R62.1) — **the collected shape, not a person's.**
 *
 * `phone` and `notes` are absent, and their absence is the design rather than an
 * oversight: R62 declares what is collected about a minor, and the server's
 * schema rejects both outright. Modelling a child as a `PersonForm` would put
 * two inputs back on the screen that no longer have anywhere to go.
 *
 * The two decisions that *are* per child live here for the same reason — the
 * media release (R62.3b) and the schooling stage (R62.7) belong to a child, not
 * to a family.
 */
/** The applicant: the shared names, plus the two fields only an adult gives. */
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
  // R62 — the two fields a child has and an adult does not.
  schooling_stage: 'schoolingStage',
  consent_media_release: 'mediaRelease',
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
    // `children.1.last_name_arabic` → person `children.1` (R62: the index is
    // part of the identity, because two children can fail differently and the
    // form must mark the right one).
    const segments = path.split('.');
    const tail = segments.length > 1 ? segments[segments.length - 1]! : path;
    const head = segments.slice(0, -1).join('.');
    // The form calls the parent "applicant".
    const person = head === 'parent' ? 'applicant' : head;
    const known = person === 'applicant' || /^children\.\d+$/.test(person);

    if (segments.length > 1 && SERVER_FIELD_PATHS[tail] && known) {
      fields[`${person}.${SERVER_FIELD_PATHS[tail]}`] = t('register.errServerField');
      continue;
    }
    if (path === 'branch_id') {
      fields['branch'] = t('register.errBranch');
      continue;
    }
    if (path === 'framing' || path === 'framing.mode') {
      fields['framingMode'] = t('register.errFramingMode');
      continue;
    }
    if (path.startsWith('framing.willingness')) {
      fields['framingBranches'] = t('register.errFramingBranches');
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
    /**
     * **`DUPLICATE` is two different dead ends, and they had one message.**
     *
     * The server distinguishes them and this did not: an address that already
     * belongs to an account came back as *«ابدئي تسجيل الدخول من جديد»*, which
     * is advice that cannot work — signing in again reaches the same taken
     * address. The applicant was told to repeat the one step guaranteed to fail.
     *
     * `EMAIL_ALREADY_CLAIMED` is `registration.service`'s own reason, raised
     * under the normalized-email lock after re-reading **both** ownership
     * channels, so it is authoritative rather than a guess from a status code.
     */
    case 'DUPLICATE':
      return error.details['reason'] === 'EMAIL_ALREADY_CLAIMED'
        ? t('register.emailTaken')
        : t('register.tokenSpent');
    // The onboarding token is single-use and short-lived (§4.1b). A replay or an
    // expiry is not "try again" — it is "start the sign-in again", and saying so
    // is the difference between a fixable dead end and a mysterious one.
    case 'STATE_CONFLICT':
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
  /** The FORM's three options, not the wire's two `kind`s — a teacher applying
   *  is an adult registering themselves (R49). */
  intent: 'adult' | 'parent_child' | 'teacher';
  applicant: PersonForm;
  children: ChildForm[];
  branchId: string | null;
  categoryId: string | null;
  framingMode: '' | 'in_person' | 'online' | 'both';
  allFramingBranches: boolean;
  framingBranchIds: string[];
  dataProcessing: boolean;
}

export function validate(state: FormState): Record<string, string> {
  const errors: Record<string, string> = {};

  const person = (p: PersonForm | ChildForm, prefix: string) => {
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

    // Only an adult gives one — a child has no `phone` field to validate.
    const phone = 'phone' in p ? p.phone.trim() : '';
    if (phone !== '' && (!PHONE_PATTERN.test(phone) || phone.length < LIMITS.phoneMin || phone.length > LIMITS.phoneMax))
      errors[`${prefix}.phone`] = t('register.errPhone');
  };

  person(state.applicant, 'applicant');
  // The children's rules live with the children's fields (R65), so the two
  // flows validate identically by construction rather than by review.
  if (state.intent === 'parent_child') Object.assign(errors, validateChildren(state.children));

  // §4.1 Revision 39 — a choice, never a default. Defaulting would place
  // someone at a branch nobody picked.
  // R67 — the applicant's own branch, on the adult path only. The parent+child
  // path asks it per child, and the server derives the applicant's from the
  // first.
  if (state.intent === 'adult' && !state.branchId) errors['branch'] = t('register.errBranch');

  // R49 — required for a student, and meaningless for a staff request: a
  // teacher is admitted to no Level, and the server refuses the pair together.
  if (state.intent === 'adult' && !state.categoryId)
    errors['category'] = t('register.errCategory');

  if (state.intent === 'teacher') {
    if (state.framingMode === '') errors['framingMode'] = t('register.errFramingMode');
    if (
      (state.framingMode === 'in_person' || state.framingMode === 'both') &&
      !state.allFramingBranches &&
      state.framingBranchIds.length === 0
    ) {
      errors['framingBranches'] = t('register.errFramingBranches');
    }
  }

  // §4.1: there is no lawful basis to create the record without this, so it is
  // refused rather than warned about.
  if (!state.dataProcessing) errors['dataProcessing'] = t('register.errConsent');

  return errors;
}

export function buildPayload(state: {
  intent: 'adult' | 'parent_child' | 'teacher';
  applicant: PersonForm;
  children: ChildForm[];
  branchId: string | null;
  categoryId: string | null;
  framingMode: '' | 'in_person' | 'online' | 'both';
  allFramingBranches: boolean;
  framingBranchIds: string[];
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

  if (state.intent === 'teacher') {
    const mode = state.framingMode as 'in_person' | 'online' | 'both';
    return {
      kind: 'adult',
      applicant: person(state.applicant),
      requested_role: 'teacher',
      framing:
        mode === 'online'
          ? { mode }
          : {
              mode,
              willingness: state.allFramingBranches
                ? { all_branches: true }
                : { all_branches: false, branch_ids: state.framingBranchIds },
            },
      consents: { data_processing: true },
    };
  }

  if (state.intent === 'adult') {
    return {
      kind: 'adult',
      applicant: person(state.applicant),
      branch_id: state.branchId!,
      category_id: state.categoryId!,
      consents: { data_processing: true },
    };
  }
  return {
    kind: 'parent_child',
    parent: person(state.applicant),
    // R67 — each child carries its own branch and stage; the request carries
    // neither, and the server refuses one that does.
    children: state.children.map(toChildInput),
    consents: { data_processing: true },
  };
}
