import { useState, type ReactNode } from 'react';

import { submitChildApplications } from '../adapters/child-applications.js';
import type { ChildInput } from '../adapters/registrations.js';
import { useSession } from '../contexts/session.js';
import { t } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { SelectField, TextField } from './ui/field.js';
import { FormDialog } from './ui/form-dialog.js';

/**
 * «＋ تسجيل طفل» — a signed-in adult registers a child (R62.9, §4.3).
 *
 * **A dialog, not a page, and that is a §20 rule 16 decision.** §4.3 says the
 * parent submits *"from the role switcher's «＋ تسجيل طفل» action"*; §14.1 lists
 * no route for it, and inventing one would be navigation outside the sitemap.
 * A dialog opened from the switcher is the affordance the SRS describes.
 *
 * **One child at a time here, deliberately.** `POST /child-applications` takes
 * up to twelve, and the *public registration form* uses that because a family
 * arrives at once. A parent already on the platform is adding one child; a
 * repeatable section for the rarer case would be a second multi-child form to
 * keep in step with the first, and the parent can simply open this twice.
 *
 * **The fields are exactly `childCore`'s** — no phone and no free-text notes,
 * because the server rejects both outright (R62.1). The consents are the two
 * R62.3b requires: data processing for the request, media release per child.
 */
const SCHOOLING_STAGES: NonNullable<ChildInput['schooling_stage']>[] = [
  'pre_primary',
  'primary',
  'middle',
  'high',
  'post_secondary',
  'not_in_school',
];

export function ChildApplicationDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { accessToken } = useSession();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sex, setSex] = useState<'' | 'female' | 'male'>('');
  const [stage, setStage] = useState<'' | NonNullable<ChildInput['schooling_stage']>>('');
  const [mediaRelease, setMediaRelease] = useState<'' | 'yes' | 'no'>('');
  const [dataProcessing, setDataProcessing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The server's own completeness rule, mirrored so the button says what will
  // happen (§1.1 — the server still validates). A media release that is simply
  // unanswered is NOT a refusal (BR-1), so an answer is required rather than
  // defaulted.
  const complete =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    sex !== '' &&
    mediaRelease !== '' &&
    dataProcessing;

  async function submit(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await submitChildApplications(
        [
          {
            first_name_arabic: firstName.trim(),
            last_name_arabic: lastName.trim(),
            sex: sex as 'female' | 'male',
            ...(stage ? { schooling_stage: stage } : {}),
            consent_media_release: mediaRelease === 'yes',
          },
        ],
        accessToken,
      );
      setDone(true);
    } catch (error) {
      // The server's own reason where it gave one — a missing consent text
      // version is a configuration gap an operator can fix in one step, and
      // "try again later" would send the reader away from that action.
      setNotice(
        error instanceof ApiError && error.details['reason'] === 'CONSENT_TEXT_VERSION_MISSING'
          ? t('register.consentVersionMissing')
          : t('child.registerFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    // §4.1: the application enters Pending and the parent is told exactly that
    // — never "success", which would imply a child they can already act for.
    return (
      <FormDialog
        open
        title={t('child.register')}
        submitLabel={t('common.close')}
        onSubmit={onClose}
        onCancel={onClose}
      >
        <p role="status">{t('child.registerSubmitted')}</p>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open
      title={t('child.register')}
      notice={notice}
      busy={busy}
      disabled={!complete}
      submitLabel={t('child.registerSubmit')}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextField
        label={t('register.firstNameArabic')}
        value={firstName}
        onChange={setFirstName}
        required
      />
      <TextField
        label={t('register.lastNameArabic')}
        value={lastName}
        onChange={setLastName}
        required
      />
      <SelectField
        label={t('register.sex')}
        value={sex}
        onChange={(next) => setSex(next as typeof sex)}
        placeholder={t('common.choose')}
        options={[
          { value: 'female', label: t('register.sexFemale') },
          { value: 'male', label: t('register.sexMale') },
        ]}
        required
      />
      {/* R62.7 — informs the placement decision and never makes it. */}
      <SelectField
        label={t('register.schoolingStage')}
        value={stage}
        onChange={(next) => setStage(next as typeof stage)}
        placeholder={t('register.schoolingStageChoose')}
        options={SCHOOLING_STAGES.map((value) => ({
          value,
          label: t(`register.schoolingStage_${value}`),
        }))}
        hint={t('register.schoolingStageHint')}
      />
      <SelectField
        label={t('register.consentMedia')}
        value={mediaRelease}
        onChange={(next) => setMediaRelease(next as typeof mediaRelease)}
        placeholder={t('register.consentMediaChoose')}
        options={[
          { value: 'yes', label: t('common.yes') },
          { value: 'no', label: t('common.no') },
        ]}
        required
        hint={t('register.consentMediaHint')}
      />
      {/* A checkbox rather than a three-state control: §4.1a gives no lawful
          basis to record the application at all without it, so there is no
          "no" to store — the request simply cannot be made. */}
      <label className="field__checkbox">
        <input
          type="checkbox"
          checked={dataProcessing}
          onChange={(event) => setDataProcessing(event.target.checked)}
        />
        <span>{t('child.registerConsent')}</span>
      </label>
    </FormDialog>
  );
}
