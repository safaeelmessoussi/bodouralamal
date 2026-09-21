import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../../adapters/branches.js';
import { fetchCalendarBootstrap, type CategoryRef } from '../../adapters/calendar.js';
import { fetchOwnProfile } from '../../adapters/profile.js';
import { fetchActiveConsentText, type ActiveConsentText } from '../../adapters/registrations.js';
import {
  fetchMyRoleRequests,
  requestFurtherRole,
  type AskableRole,
  type FurtherRoleRequest,
} from '../../adapters/role-requests.js';
import { ConsentNotice } from '../../components/consent-notice.js';
import { ApplicationHeader } from '../../components/header/application-header.js';
import {
  AdministrationSectionFields,
  EMPTY_STUDENT_SECTION,
  EMPTY_TEACHING_SECTION,
  StudentSectionFields,
  TeachingSectionFields,
  framingPayload,
  studentSectionPayload,
  useCircleSlots,
  validateStudentSection,
  validateTeachingSection,
  type StudentSectionValue,
  type TeachingSectionValue,
} from '../../components/registration/role-sections.js';
import { SiteFooter } from '../../components/site-footer.js';
import { ErrorState } from '../../components/states.js';
import { Button, ButtonLink } from '../../components/ui/button.js';
import { Container } from '../../components/ui/container.js';
import { DateField, SelectField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { isRealPastDate } from '../../lib/birth-date.js';
import { consentFailure } from '../../lib/consent-failure.js';

/**
 * `/profile/request-role` — **«طلب صفة إضافية»** (SRS Revision 169 §1).
 *
 * The Owner, 2026-09-21: an account that already exists may ask for a further
 * role through a form, and a declined role may be asked for again. So this is
 * the registration form's role sections — the SAME components, not a copy
 * (`role-sections.tsx`) — one role at a time, from a person the platform
 * already knows: no name, no phone, no Google step.
 *
 * What is offered is the server's answer (`askable`): never a role she holds,
 * never one already waiting, and never «أسجّل أبنائي» — registering a child IS
 * that request and has its own page. **Asking grants nothing**, and the page
 * says so in the words the registration form uses.
 */
export interface RequestRoleState {
  kind: AskableRole | '';
  student: StudentSectionValue;
  teaching: TeachingSectionValue;
  /** Asked ONLY when her record has no date of birth (R130: completion). */
  needsBirthDate: boolean;
  birthDate: string;
  dataProcessing: boolean;
  circlesOffered: number;
}

export function validateRequest(state: RequestRoleState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (state.kind === '') errors['kind'] = t('register.errRequired');
  if (state.kind === 'student') {
    Object.assign(errors, validateStudentSection(state.student, state.circlesOffered));
    if (state.needsBirthDate) {
      const dob = state.birthDate.trim();
      if (dob === '') errors['birthDate'] = t('register.errRequired');
      else if (!isRealPastDate(dob)) errors['birthDate'] = t('register.errBirthDateInvalid');
    }
    // §4.1: no lawful basis to admit a beneficiary without it.
    if (!state.dataProcessing) errors['dataProcessing'] = t('register.errConsent');
  }
  if (state.kind === 'teaching') Object.assign(errors, validateTeachingSection(state.teaching));
  return errors;
}

/** What is SENT is decided by `kind` alone — never by whether another role's
 *  section still happens to hold a value. */
export function buildRequest(
  state: RequestRoleState,
  administrationBranchId: string | null,
  consentTextId: string,
): FurtherRoleRequest {
  if (state.kind === 'student') {
    return {
      kind: 'student',
      student: studentSectionPayload(state.student),
      ...(state.needsBirthDate ? { birth_date: state.birthDate.trim() } : {}),
      consents: { data_processing: true, consent_text_id: consentTextId },
    };
  }
  if (state.kind === 'teaching') return { kind: 'teaching', teaching: { framing: framingPayload(state.teaching) } };
  return { kind: 'administration', administration: { branch_id: administrationBranchId } };
}

export function explainRequestFailure(error: unknown): string {
  const consent = consentFailure(error);
  if (consent) return consent;
  if (error instanceof ApiError) {
    const reason = error.details['reason'];
    if (reason === 'ROLE_ALREADY_HELD') return t('profile.requestRole.errHeld');
    if (reason === 'ALREADY_PENDING') return t('profile.requestRole.errPending');
    if (reason === 'CIRCLE_NOT_OFFERED') return t('register.errCircleGone');
  }
  return t('profile.requestRole.failed');
}

export function RequestRolePage(): ReactNode {
  const { accessToken } = useSession();

  const [askable, setAskable] = useState<AskableRole[] | null>(null);
  const [needsBirthDate, setNeedsBirthDate] = useState(false);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [consentText, setConsentText] = useState<ActiveConsentText | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [kind, setKind] = useState<AskableRole | ''>('');
  const [student, setStudent] = useState<StudentSectionValue>(EMPTY_STUDENT_SECTION);
  const [teaching, setTeaching] = useState<TeachingSectionValue>(EMPTY_TEACHING_SECTION);
  const [administrationBranchId, setAdministrationBranchId] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [dataProcessing, setDataProcessing] = useState(false);

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [mine, profile, live, bootstrap] = await Promise.all([
        fetchMyRoleRequests(accessToken),
        fetchOwnProfile(accessToken),
        fetchBranches(),
        fetchCalendarBootstrap({ from: today, to: today }),
      ]);
      setAskable(mine.askable);
      setNeedsBirthDate(profile.birth_date === null);
      setBranches(live);
      setCategories(bootstrap.categories);
    } catch {
      // All four are required: offering the form without them would let her
      // fill it in and fail at submit.
      setLoadFailed(true);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveConsentText()
      .then((row) => {
        if (!cancelled) setConsentText(row);
      })
      .catch(() => {
        if (!cancelled) setConsentText(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slots = useCircleSlots(student, kind === 'student', () =>
    setStudent((current) => ({ ...current, circlePreferences: [] })),
  );

  const state: RequestRoleState = {
    kind,
    student,
    teaching,
    needsBirthDate,
    birthDate,
    dataProcessing,
    circlesOffered: slots?.circles.length ?? 0,
  };
  const errors = validateRequest(state);
  // Fail closed: a beneficiary request with no wording in force has nothing to
  // agree to, so it is refused here as well as by the server.
  const valid = Object.keys(errors).length === 0 && (kind !== 'student' || consentText !== null);

  async function submit(): Promise<void> {
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setFailure(null);
    try {
      await requestFurtherRole(buildRequest(state, administrationBranchId, consentText?.id ?? ''), accessToken);
      setDone(true);
    } catch (error) {
      setFailure(explainRequestFailure(error));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <ApplicationHeader />
        <main id="main" className="auth-page" role="status">
          <h1>{t('profile.requestRole.sentTitle')}</h1>
          {/* Pending, and said so — never «تمّ», which would imply a role she
              can already act in. */}
          <p>{t('profile.requestRole.sent')}</p>
          <div className="auth-page__links">
            <ButtonLink variant="primary" href="/profile">
              {t('child.backToProfile')}
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
          <h1>{t('profile.requestRole.title')}</h1>
          <p className="lede">{t('profile.requestRole.lede')}</p>

          {loadFailed ? (
            <ErrorState onRetry={() => void load()} />
          ) : askable === null ? (
            <p className="state" role="status">
              {t('common.loading')}
            </p>
          ) : askable.length === 0 ? (
            // Rule AF — the fact, not an empty form: there is nothing to ask for.
            <p className="state" role="status" data-nothing-askable>
              {t('profile.requestRole.nothingToAsk')}
            </p>
          ) : (
            <form
              className="register-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <fieldset className="register-form__group" data-role-choices>
                <legend>{t('profile.requestRole.kindLegend')}</legend>
                <SelectField
                  label={t('profile.requestRole.kindLabel')}
                  value={kind}
                  onChange={(next) => {
                    setKind(next as AskableRole | '');
                    // Another role's answers are erased at once, not left for
                    // the payload builder to remember to omit.
                    setStudent(EMPTY_STUDENT_SECTION);
                    setTeaching(EMPTY_TEACHING_SECTION);
                    setAdministrationBranchId(null);
                    setBirthDate('');
                    setDataProcessing(false);
                    setTouched(false);
                  }}
                  required
                  options={[
                    { value: '', label: t('common.choose') },
                    ...askable.map((role) => ({ value: role, label: t(`admin.approvals.roleKind.${role}`) })),
                  ]}
                  hint={t('profile.requestRole.kindHint')}
                  error={touched ? (errors['kind'] ?? null) : null}
                />
              </fieldset>

              {kind === 'student' ? (
                <fieldset className="register-form__group" data-role-section="student">
                  <legend>{t('register.branchLegend')}</legend>
                  <StudentSectionFields
                    value={student}
                    onChange={setStudent}
                    branches={branches}
                    categories={categories}
                    slots={slots}
                    errors={touched ? errors : {}}
                  />
                  {needsBirthDate ? (
                    <DateField
                      label={t('register.birthDate')}
                      value={birthDate}
                      onChange={setBirthDate}
                      hint={t('register.birthDateHint')}
                      required
                      error={touched ? (errors['birthDate'] ?? null) : null}
                    />
                  ) : null}
                </fieldset>
              ) : null}

              {kind === 'teaching' ? (
                <fieldset className="register-form__group" data-role-section="teaching">
                  <legend>{t('register.framingLegend')}</legend>
                  <TeachingSectionFields
                    value={teaching}
                    onChange={setTeaching}
                    branches={branches}
                    errors={touched ? errors : {}}
                  />
                </fieldset>
              ) : null}

              {kind === 'administration' ? (
                <fieldset className="register-form__group" data-role-section="administration">
                  <legend>{t('register.administrationLegend')}</legend>
                  <AdministrationSectionFields
                    branchId={administrationBranchId}
                    onChange={setAdministrationBranchId}
                    branches={branches}
                  />
                </fieldset>
              ) : null}

              {kind === 'student' ? (
                <fieldset className="register-form__group">
                  <legend>{t('register.consentLegend')}</legend>
                  <ConsentNotice
                    text={consentText?.body_arabic ?? null}
                    checked={dataProcessing}
                    onChange={setDataProcessing}
                    error={touched ? (errors['dataProcessing'] ?? null) : null}
                  />
                </fieldset>
              ) : null}

              {failure ? (
                <p className="field__error" role="alert">
                  {failure}
                </p>
              ) : null}

              <div className="register-form__actions">
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? t('common.saving') : t('profile.requestRole.submit')}
                </Button>
                <ButtonLink variant="secondary" href="/profile">
                  {t('common.cancel')}
                </ButtonLink>
              </div>
            </form>
          )}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
