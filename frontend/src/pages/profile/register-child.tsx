import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../../adapters/branches.js';
import { fetchCalendarBootstrap, type CategoryRef } from '../../adapters/calendar.js';
import { submitChildApplications } from '../../adapters/child-applications.js';
import {
  ChildrenFieldset,
  EMPTY_CHILD,
  toChildInput,
  validateChildren,
  type ChildForm,
} from '../../components/registration/children.js';
import { ApplicationHeader } from '../../components/header/application-header.js';
import { SiteFooter } from '../../components/site-footer.js';
import { ConsentNotice } from '../../components/consent-notice.js';
import { ErrorState } from '../../components/states.js';
import { Button } from '../../components/ui/button.js';
import { Container } from '../../components/ui/container.js';
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
export function RegisterChildPage(): ReactNode {
  const { accessToken } = useSession();

  /** R65 — **one or more**, exactly as `/register` takes them. The personal
   *  page had lost the repeatable section, so a parent of three submitted three
   *  requests here while the public form took them in one. */
  const [children, setChildren] = useState<ChildForm[]>([EMPTY_CHILD]);
  const [dataProcessing, setDataProcessing] = useState(false);

  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [referenceFailed, setReferenceFailed] = useState(false);

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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

  const errors = validate(children, dataProcessing);
  const valid = Object.keys(errors).length === 0;

  async function submit(): Promise<void> {
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setFailure(null);
    try {
      await submitChildApplications(
        // One translation, shared with `/register` (R65) — the branch and stage
        // are request-level answers this page asks per submission, so they are
        // attached here rather than living inside a child's fields.
        // R67 — `toChildInput` already carries each child's own branch and
        // stage; there is nothing request-level left to attach.
        children.map(toChildInput),
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
              <ChildrenFieldset
                children={children}
                onChange={setChildren}
                errors={errors}
                touched={touched}
                branches={branches}
                categories={categories}
              />

              {/* R67 — **no request-level branch or stage.** Both moved onto each
                  child above, so one submission can ask for two children at two
                  branches in two stages. They were the last fields on this page
                  that a family shared. */}

              <fieldset className="register-form__group">
                <legend>{t('register.consentLegend')}</legend>
                <ConsentNotice
                  checked={dataProcessing}
                  onChange={setDataProcessing}
                  error={touched ? (errors['dataProcessing'] ?? null) : null}
                />
                {/* R62.3b — the media release is PER CHILD and lives in each
                    child's own fieldset above; a parent may permit photographs
                    of one and refuse for another. */}
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
 * The page's own rules: the shared child rules, plus the two request-level
 * answers this surface collects (R64 — `/register` asks them once for the
 * family; here they are asked per submission).
 */
export function validate(
  children: ChildForm[],
  dataProcessing: boolean,
): Record<string, string> {
  // R67 — the branch and stage moved onto each child, so the only thing left
  // that belongs to the REQUEST is the consent that makes it lawful.
  const errors = validateChildren(children);

  // §4.1a — no lawful basis without it, so it is refused rather than warned about.
  if (!dataProcessing) errors['dataProcessing'] = t('register.errConsent');

  return errors;
}
