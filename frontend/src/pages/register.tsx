import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckboxField, SelectField, TextField } from '../components/ui/field.js';
import { MultiSelectField } from '../components/ui/multi-select.js';

import { fetchBranches, type PublicBranch } from '../adapters/branches.js';
import {
  LIMITS,
  PHONE_PATTERN,
  fetchActiveConsentText,
  fetchCircleSlots,
  submitRegistration,
  type ActiveConsentText,
  type CircleSlots,
  type PersonInput,
  type RegistrationInput,
  type RoleChoice,
} from '../adapters/registrations.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { ConsentNotice } from '../components/consent-notice.js';
import { consentFailure } from '../lib/consent-failure.js';
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
import { CircleRanking } from '../components/registration/circle-ranking.js';
import { PersonFields } from '../components/registration/person-fields.js';
import { requestSelfManagedClaim } from '../adapters/self-managed-claims.js';
import { t } from '../i18n/index.js';
import { isRealPastDate } from '../lib/birth-date.js';
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
/** The four things the form offers, in the order it offers them (R168 §1). */
export const ROLE_CHOICES: readonly RoleChoice[] = ['student', 'guardian', 'teaching', 'administration'];

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
  /**
   * **R132 adds a fourth MODE, not a fourth page.** A former minor claiming the
   * record she already has needs exactly the identity half this page already
   * holds — the same OAuth callback and the same onboarding token — so the only
   * new thing she supplies is her reference code.
   */
  /**
   * **SRS Revision 168 §1 — what she is here to ask for: ANY COMBINATION of
   * four.** It was one choice among three. A mother who memorises, teaches and
   * registers her daughters submitted three forms, typed her own name three
   * times, and was approved or refused three times over; now she ticks three
   * boxes, is asked who she is ONCE, and each request is decided on its own.
   *
   * `self_managed` (R132) is still not a registration at all — it claims a
   * record that exists — so it stays a MODE beside the roles, reached as before.
   */
  // Nothing is preselected: the Owner lists four choices as equals, and a box
  // ticked for her is a request she did not make (the same reason «أول مرة» is
  // never defaulted). An untouched form says «اختاري طلبًا واحدًا على الأقل».
  const [roles, setRoles] = useState<RoleChoice[]>([]);
  // **No entry on the form, by the Owner's decision** (R160 §8, 2026-09-16: the
  // option is withdrawn for this release, the flow kept). It is reached by
  // `/register?mode=self-managed` — the link the administration gives her — and
  // left by «العودة إلى التسجيل», a STATE change, because her single-use
  // onboarding token lives in this page's memory and a navigation would lose it.
  const [selfManaged, setSelfManaged] = useState(
    () => new URLSearchParams(window.location.search).get('mode') === 'self-managed',
  );
  const [selfManagedCode, setSelfManagedCode] = useState('');
  const asks = (role: RoleChoice): boolean => roles.includes(role);
  /** «هل هذه أول مرة تلتحقين فيها؟» — asked of a مستفيدة, never defaulted. */
  const [firstTime, setFirstTime] = useState<'' | 'yes' | 'no'>('');
  const [circleSlots, setCircleSlots] = useState<CircleSlots | null>(null);
  const [circlePreferences, setCirclePreferences] = useState<string[]>([]);
  const [administrationBranchId, setAdministrationBranchId] = useState<string | null>(null);
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
  /**
   * **The exact wording this form will record** (R119).
   *
   * The text and its id arrive in ONE response, which is what removes the
   * *«frontend text X, separately fetched version Y»* race by construction: the
   * checkbox renders `consentText.body_arabic`, and the submission carries
   * `consentText.id`, so there is no second source for either half.
   *
   * `null` is fail-closed and is a real state — nothing in force, or the read
   * failed. `ConsentNotice` then renders the refusal instead of a checkbox, and
   * `validationErrors` refuses the submit, so a tick against nothing is
   * impossible rather than merely unlikely.
   */
  const [consentText, setConsentText] = useState<ActiveConsentText | null>(null);

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [failureId, setFailureId] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<ServerErrors>({ fields: {}, unmapped: [] });
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveConsentText()
      .then((row) => {
        if (!cancelled) setConsentText(row);
      })
      // A refusal here is the fail-closed 503 as often as it is a network
      // fault, and both mean the same thing to the person: there is no wording
      // to agree to. `null` says so; inventing a fallback would not.
      .catch(() => {
        if (!cancelled) setConsentText(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  /**
   * **What she may choose between is asked of the server, for HER Category and
   * branch** (R168 §1) — the scheduled memorisation classes of that Category's
   * first Level there. A failed read offers nothing rather than blocking the
   * form: the order is a wish, and the administration places her either way.
   */
  const wantsSlots = roles.includes('student') && firstTime === 'yes' && branchId && categoryId;
  useEffect(() => {
    setCircleSlots(null);
    setCirclePreferences([]);
    if (!wantsSlots) return;
    let cancelled = false;
    void fetchCircleSlots(categoryId, branchId)
      .then((slots) => {
        if (!cancelled) setCircleSlots(slots);
      })
      .catch(() => {
        if (!cancelled) setCircleSlots({ level: null, circles: [], fixed: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [wantsSlots, branchId, categoryId]);

  const localErrors = validate({
    selfManaged,
    roles,
    firstTime,
    circlePreferences,
    // What is on offer decides whether an order is owed: fewer than two
    // circles is not a choice, and nothing is asked.
    circlesOffered: circleSlots?.circles.length ?? 0,
    applicant,
    children,
    branchId,
    categoryId,
    framingMode,
    allFramingBranches,
    framingBranchIds,
    dataProcessing,
    selfManagedCode,
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
      /**
       * **R132 — a different verb, deliberately.** This arm creates no account
       * and submits no registration: it records a claim on a record that
       * already exists, which a Super Admin then decides. Folding it into
       * `POST /registrations` would have made one endpoint mean two things.
       */
      if (selfManaged) {
        await requestSelfManagedClaim(selfManagedCode.trim().toUpperCase(), token);
        setDone(true);
        return;
      }

      await submitRegistration(
        buildPayload({
          roles,
          firstTime,
          circlePreferences,
          administrationBranchId,
          applicant,
          children,
          branchId,
          categoryId,
          framingMode,
          allFramingBranches,
          framingBranchIds,
          // R119 — the id of the wording that was actually on screen. Guarded
          // above: `valid` is false without it.
          consentTextId: consentText!.id,
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
          {/**
            * **R132 — a claim did not submit a registration**, and saying so
            * matters: the registration wording tells her an application was
            * received and will be decided, which is true of a different thing.
            * She asked to be given her own login on a record that already
            * exists, and what she needs to read is that nothing has changed yet.
            */}
          <h1>
            {selfManaged ? t('register.selfManagedLegend') : t('register.submittedTitle')}
          </h1>
          <p>
            {selfManaged ? t('register.selfManagedSent') : t('register.submittedBody')}
          </p>
          {selfManaged ? null : (
            <p className="muted">{t('register.submittedNext')}</p>
          )}
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
            {selfManaged ? null : (
              /**
               * **Four things, any combination** (SRS Revision 168 §1). Checkboxes
               * and not a select: the question has several answers, and a control
               * that can hold only one is what made a mother who memorises,
               * teaches and registers her daughters fill this form three times.
               * Unticking a role ERASES what its section held at once — hidden
               * values are never trusted to a later payload builder to omit.
               */
              <fieldset className="register-form__group" data-role-choices>
                <legend>{t('register.rolesLegend')}</legend>
                <p className="field__hint">{t('register.rolesHint')}</p>
                {ROLE_CHOICES.map((role) => (
                  // `data-role-choice` — a control is addressed by what it IS:
                  // the wording of a choice is the association's to change.
                  <div key={role} data-role-choice={role}>
                    <CheckboxField
                      label={t(`register.role.${role}`)}
                      checked={asks(role)}
                      onChange={(checked) => {
                        setRoles((current) =>
                          ROLE_CHOICES.filter((r) => (r === role ? checked : current.includes(r))),
                        );
                        if (checked) return;
                        if (role === 'student') {
                          setBranchId(null);
                          setCategoryId(null);
                          setFirstTime('');
                          setCirclePreferences([]);
                          setApplicant((a) => ({ ...a, birthDate: '' }));
                        }
                        if (role === 'guardian') setChildren([EMPTY_CHILD]);
                        if (role === 'teaching') {
                          setFramingMode('');
                          setAllFramingBranches(false);
                          setFramingBranchIds([]);
                        }
                        if (role === 'administration') setAdministrationBranchId(null);
                      }}
                    />
                  </div>
                ))}
                {touched && errors['roles'] ? (
                  <p className="field__error" role="alert">
                    {errors['roles']}
                  </p>
                ) : null}
              </fieldset>
            )}

            {selfManaged ? (
              /**
               * **R132 — said plainly, because the honest sentence is the whole
               * point.** Verifying a Google account does NOT move her record;
               * the administration reviews the request, and her educational
               * history stays on the same account. A page implying instant
               * transfer would promise something the server refuses to do.
               */
              <fieldset className="register-form__group">
                <legend>{t('register.selfManagedLegend')}</legend>
                <p className="state" role="status">
                  {t('register.selfManagedNotice')}
                </p>
                <TextField
                  label={t('register.selfManagedCode')}
                  value={selfManagedCode}
                  onChange={setSelfManagedCode}
                  hint={t('register.selfManagedCodeHint')}
                  required
                  error={touched ? (errors['selfManagedCode'] ?? null) : null}
                />
                <div className="form__actions">
                  <Button variant="ghost" onClick={() => setSelfManaged(false)}>
                    {t('register.selfManagedBack')}
                  </Button>
                </div>
              </fieldset>
            ) : null}

            {/**
              * **R132 — everything below is REGISTRATION, and a claim is not
              * one.** She is not creating a record; the record exists, her
              * identity comes from the token, and her name, branch, stage and
              * consents are already held by the association. Rendering them
              * would ask her to restate what the platform already knows and
              * would imply the answers matter to a decision that ignores them.
              */}
            {selfManaged ? null : (
              <>
            <fieldset className="register-form__group">
              {/* R168 §1 — her identity is asked ONCE whatever is ticked. It is
                  «بيانات وليّ الأمر» only when registering children is ALL she
                  asked for; any other role's section is the same person's data,
                  so that heading replaces it (the Owner's rule). */}
              <legend>
                {roles.length === 1 && asks('guardian') ? t('register.parent') : t('register.you')}
              </legend>
              <PersonFields
                value={applicant}
                onChange={setApplicant}
                errors={touched ? errors : {}}
                prefix="applicant"
                phoneRequired
                /* R130 — asked only when the applicant IS the beneficiary. A
                   staff request is not a beneficiary admission and the server
                   refuses the field; a guardian registering children is
                   admitted to nothing (R129) and each child is asked instead. */
                collectBirthDate={asks('student')}
                birthDateRequired={asks('student')}
              />
            </fieldset>

            {asks('guardian') ? (
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
            {asks('teaching') ? (
              <fieldset className="register-form__group" data-role-section="teaching">
                <legend>{t('register.framingLegend')}</legend>
                {/* Said plainly rather than implied: submitting this asks for
                    something a person has to grant. */}
                <p className="state" role="status">
                  {t('register.teacherNotice')}
                </p>
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
            ) : null}

            {asks('administration') ? (
              /**
               * **She asks; she does not choose** (R168 §1). Which administrative
               * role — مديرة or مديرة النظام — and over which branches is the
               * approving Super Admin's decision alone, so the form offers no
               * such control: only where she would prefer to serve, if anywhere.
               */
              <fieldset className="register-form__group" data-role-section="administration">
                <legend>{t('register.administrationLegend')}</legend>
                <p className="state" role="status">
                  {t('register.administrationNotice')}
                </p>
                <BranchSelector
                  branches={branches}
                  value={administrationBranchId}
                  onChange={setAdministrationBranchId}
                  label={t('register.administrationBranchLabel')}
                  allowAll={false}
                  emptyLabel={t('register.administrationBranchEmpty')}
                  hint={t('register.administrationBranchHint')}
                />
              </fieldset>
            ) : null}

            {asks('student') ? (
              <fieldset className="register-form__group" data-role-section="student">
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

                {/* «هل هذه أول مرة؟» — a choice, never a default: a returning
                    مستفيدة is placed by the administration, who know her. */}
                <SelectField
                  label={t('register.firstTimeLabel')}
                  value={firstTime}
                  onChange={(next) => {
                    setFirstTime(next as typeof firstTime);
                    if (next !== 'yes') setCirclePreferences([]);
                  }}
                  required
                  options={[
                    { value: '', label: t('common.choose') },
                    { value: 'yes', label: t('register.firstTimeYes') },
                    { value: 'no', label: t('register.firstTimeNo') },
                  ]}
                  hint={t('register.firstTimeHint')}
                  error={touched ? (errors['firstTime'] ?? null) : null}
                />

                {firstTime === 'yes' && circleSlots ? (
                  <CircleRanking
                    slots={circleSlots}
                    value={circlePreferences}
                    onChange={setCirclePreferences}
                    error={touched ? (errors['circles'] ?? null) : null}
                  />
                ) : null}
              </fieldset>
            ) : null}

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
                // R119 — the stored wording, rendered verbatim.
                text={consentText?.body_arabic ?? null}
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

              </>
            )}

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
  sex: '' | 'female' | 'male';
  /**
   * **R130 — the applicant's own, and only when the applicant IS the
   * beneficiary.** A woman registering herself carries one; a مؤطِّرة applying
   * to teach does not, and neither does a guardian registering children (R129).
   * Kept on the shared shape and omitted from the payload on those two paths,
   * because the server refuses it there rather than ignoring it.
   */
  birthDate: string;
}

const emptyPerson: PersonForm = {
  firstNameArabic: '',
  lastNameArabic: '',
  firstNameFrench: '',
  lastNameFrench: '',
  nickname: '',
  phone: '',
  sex: '',
  birthDate: '',
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
  sex: 'sex',
  birth_date: 'birthDate',
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
    // R168 §1 — the sections of the several-role request. A refusal of a whole
    // section («required when … is asked for») lands on that section's first
    // question, which is where she will look.
    if (path === 'roles') {
      fields['roles'] = t('register.errRoles');
      continue;
    }
    if (path === 'branch_id' || path === 'student' || path === 'student.branch_id') {
      fields['branch'] = t('register.errBranch');
      continue;
    }
    if (path === 'student.category_id') {
      fields['category'] = t('register.errCategory');
      continue;
    }
    if (path === 'student.first_time') {
      fields['firstTime'] = t('register.errRequired');
      continue;
    }
    if (path.startsWith('student.circle_preferences')) {
      fields['circles'] = t('register.errCircles');
      continue;
    }
    const framingPath = path.startsWith('teaching.') ? path.slice('teaching.'.length) : path;
    if (path === 'teaching' || framingPath === 'framing' || framingPath === 'framing.mode') {
      fields['framingMode'] = t('register.errFramingMode');
      continue;
    }
    if (framingPath.startsWith('framing.willingness')) {
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

  // R119 — the consent-wording refusals, worded once and shared with تسجيل طفل.
  const consent = consentFailure(error);
  if (consent) return consent;

  switch (error.code) {
    case 'CONSENT_REQUIRED':
      return t('register.errConsent');
    case 'VALIDATION_FAILED':
      // R168 §1 — a class was rescheduled while her form was open: the circle
      // she ranked is no longer on offer. Said in those words; the list reloads
      // when she changes her branch or stage, or simply re-answers «أول مرة».
      if (error.details['reason'] === 'CIRCLE_NOT_OFFERED') return t('register.errCircleGone');
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
  /** R132 — not a registration at all: it claims a record that already exists. */
  selfManaged: boolean;
  /** R168 §1 — everything she asks for; any combination, at least one. */
  roles: RoleChoice[];
  /** «هل هذه أول مرة؟» — a مستفيدة only; never defaulted. */
  firstTime: '' | 'yes' | 'no';
  /** Her order, most convenient first. */
  circlePreferences: string[];
  /** How many circles the server offered her — fewer than two is no choice. */
  circlesOffered: number;
  /** R132 — the reference code she already holds. Empty on every other arm. */
  selfManagedCode: string;
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
    if ('phone' in p && phone === '') errors[`${prefix}.phone`] = t('register.errRequired');
    else if (phone !== '' && (!PHONE_PATTERN.test(phone) || phone.length < LIMITS.phoneMin || phone.length > LIMITS.phoneMax))
      errors[`${prefix}.phone`] = t('register.errPhone');
  };

  /**
   * **R132 — this arm validates the code and NOTHING else, and it returns
   * BEFORE the applicant is validated.**
   *
   * She is not registering: the record exists, her identity comes from the
   * token, and the fields below are not even rendered on this arm. Placing this
   * check after `person(state.applicant, …)` made the form permanently invalid
   * against fields nobody could see, so the submit button did nothing at all —
   * a silent dead end the browser harness found and no source test would have.
   */
  if (state.selfManaged) {
    const code = state.selfManagedCode.trim().toUpperCase();
    if (!/^BA-[0-9A-Z]{4,12}$/.test(code)) {
      errors['selfManagedCode'] = t('register.errSelfManagedCode');
    }
    return errors;
  }

  const asks = (role: RoleChoice): boolean => state.roles.includes(role);
  if (state.roles.length === 0) errors['roles'] = t('register.errRoles');

  person(state.applicant, 'applicant');
  // The children's rules live with the children's fields (R65), so the two
  // flows validate identically by construction rather than by review.
  if (asks('guardian')) Object.assign(errors, validateChildren(state.children));

  // §4.1 Revision 39 — a choice, never a default. Defaulting would place
  // someone at a branch nobody picked.
  // R67 — the applicant's own branch, on the adult path only. The parent+child
  // path asks it per child, and the server derives the applicant's from the
  // first.
  if (asks('student') && !state.branchId) errors['branch'] = t('register.errBranch');

  // R49 — required for a student, and meaningless for a staff request: a
  // teacher is admitted to no Level, and the server refuses the pair together.
  if (asks('student') && !state.categoryId) errors['category'] = t('register.errCategory');

  // R168 §1 — the first-time question is asked of a مستفيدة and never defaulted;
  // a first-timer orders at least one circle WHERE there is a choice to make.
  if (asks('student')) {
    if (state.firstTime === '') errors['firstTime'] = t('register.errRequired');
    if (state.firstTime === 'yes' && state.circlesOffered >= 2 && state.circlePreferences.length === 0) {
      errors['circles'] = t('register.errCircles');
    }
  }

  /**
   * **R130 — required on the beneficiary arm and asked on no other.**
   *
   * `intent === 'adult'` is the applicant registering HERSELF, so she carries a
   * date of birth. `'teacher'` is a staff request — not a beneficiary admission,
   * and the server refuses the field there — and `'parent_child'` asks it of
   * each child instead, because the guardian is admitted to nothing (R129).
   */
  if (asks('student')) {
    const dob = state.applicant.birthDate.trim();
    if (dob === '') errors['applicant.birthDate'] = t('register.errRequired');
    else if (!isRealPastDate(dob))
      errors['applicant.birthDate'] = t('register.errBirthDateInvalid');
  }

  if (asks('teaching')) {
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
  roles: RoleChoice[];
  firstTime: '' | 'yes' | 'no';
  circlePreferences: string[];
  administrationBranchId: string | null;
  applicant: PersonForm;
  children: ChildForm[];
  branchId: string | null;
  categoryId: string | null;
  framingMode: '' | 'in_person' | 'online' | 'both';
  allFramingBranches: boolean;
  framingBranchIds: string[];
  /**
   * **R119 — the id of the wording that was on screen**, not *whatever is
   * active*. Passed in rather than fetched here: this function is pure and
   * directly tested, and a second fetch would be a second source for the half
   * of the pair that has to match the text the person read.
   */
  consentTextId: string;
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
    phone: p.phone.trim(),
  });

  /**
   * **R130 — sent only on the beneficiary arm.** The server refuses a
   * `birth_date` on a staff request rather than dropping it, so the two payload
   * builders below differ by exactly this field.
   */
  const beneficiary = (p: PersonForm): PersonInput => ({
    ...person(p),
    birth_date: p.birthDate,
  });

  /**
   * **One arm, the sections of the ticked roles and no others** (R168 §1). The
   * server REQUIRES a section for a ticked role and REFUSES one for an unticked
   * role, so what is sent is decided here by `roles` alone — never by whether a
   * hidden field happens to still hold a value.
   */
  const asks = (role: RoleChoice): boolean => state.roles.includes(role);
  const mode = state.framingMode as 'in_person' | 'online' | 'both';
  return {
    kind: 'roles',
    // A stable order, so the same ticks always make the same request.
    roles: ROLE_CHOICES.filter(asks),
    // R130 — a date of birth from a beneficiary, and from nobody else.
    applicant: asks('student') ? beneficiary(state.applicant) : person(state.applicant),
    ...(asks('student')
      ? {
          student: {
            branch_id: state.branchId!,
            category_id: state.categoryId!,
            first_time: state.firstTime === 'yes',
            ...(state.firstTime === 'yes' && state.circlePreferences.length > 0
              ? { circle_preferences: state.circlePreferences }
              : {}),
          },
        }
      : {}),
    // R67 — each child carries its own branch and stage.
    ...(asks('guardian') ? { children: state.children.map(toChildInput) } : {}),
    ...(asks('teaching')
      ? {
          teaching: {
            framing:
              mode === 'online'
                ? { mode }
                : {
                    mode,
                    willingness: state.allFramingBranches
                      ? { all_branches: true as const }
                      : { all_branches: false as const, branch_ids: state.framingBranchIds },
                  },
          },
        }
      : {}),
    ...(asks('administration') ? { administration: { branch_id: state.administrationBranchId } } : {}),
    consents: { data_processing: true, consent_text_id: state.consentTextId },
  };
}
