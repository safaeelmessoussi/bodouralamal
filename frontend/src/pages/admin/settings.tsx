import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  activateConsentText,
  createConsentText,
  listConsentTexts,
  listSettings,
  updateConsentText,
  updateSetting,
  type ConsentTextVersion,
  type Setting,
} from '../../adapters/settings.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ErrorState } from '../../components/states.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { NumberField, TextArea, TextField } from '../../components/ui/field.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

/**
 * `/superadmin/settings` — Platform Settings (§5.6, R42; R119).
 *
 * **This screen is why registration works at all.** Until a legal consent
 * wording is in force, §4.1a lets no registration be accepted; §2.3 makes
 * approving the Arabic text an Owner compliance task, so nothing is seeded and
 * this is the only place it can be put in force.
 *
 * ## What R119 changed here
 *
 * It used to carry `legal.consent_text_version`: a **free-text box** whose
 * value had no technical relationship to the wording it claimed to version —
 * that lived in the frontend's i18n catalogue and was deployed separately. An
 * administrator typing `v2` here changed nothing about what anybody read, and
 * changing what people read changed nothing here. Both drifts were silent.
 *
 * The screen now manages the **versions themselves**: the wording in force with
 * its exact Arabic text and the date it took effect, the earlier versions
 * read-only, and a create → write the wording → give it an identifier → review
 * → **activate** flow in which activation is a separate, explicit act.
 *
 * **No hash and no UUID is presented as something to manage** (Owner's
 * instruction). The identifier an administrator assigns is their own label.
 *
 * **A wording that has been in force cannot be edited.** New wording is a new
 * version, and the screen says so *before* anybody tries — the row carries how
 * many consents were recorded against it, so the reason is visible rather than
 * arriving as a refusal.
 *
 * ## The generic settings list below it
 *
 * Kept, and currently empty: the allow-list has no entries since R119 removed
 * its only one, and §5.6 will have settings again. It renders what the server
 * lists — the labels arrive as i18n *keys the backend chooses*, so a client
 * holding its own list cannot drift out of step with the allow-list.
 */
export function SettingsPage(): ReactNode {
  const { accessToken } = useSession();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setSettings(await listSettings(accessToken));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminLayout title={t('admin.nav.settings')} lede={t('admin.settings.lede')}>
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      {/* R119 — the platform's one legally-binding setting, managed as versions
          rather than as a string. Above the generic list because it is the
          reason this screen exists. */}
      <ConsentTextsSection />

      {status === 'error' ? (
        <ErrorState onRetry={() => void load()} />
      ) : status === 'loading' ? (
        <div className="skeleton" aria-live="polite" />
      ) : (
        <div className="settings-list">
          {settings.map((setting) => (
            <SettingEditor
              key={setting.key}
              setting={setting}
              token={accessToken}
              onSaved={(saved, message) => {
                setSettings((all) => all.map((s) => (s.key === saved.key ? saved : s)));
                setNotice(message);
              }}
              onConflict={(message) => {
                setNotice(message);
                void load();
              }}
            />
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

/**
 * One setting. Its own component because each carries its own `version` for
 * TD-15, and a single form over all of them would make one stale value refuse
 * every other edit in the same submit.
 */
function SettingEditor({
  setting,
  token,
  onSaved,
  onConflict,
}: {
  setting: Setting;
  token: string | null;
  onSaved: (saved: Setting, message: string) => void;
  onConflict: (message: string) => void;
}): ReactNode {
  const [draft, setDraft] = useState(setting.value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server refuses blank, so the form does too rather than letting someone
  // submit a value that would look configured and behave as unset.
  const blank = draft.trim() === '';

  async function save(): Promise<void> {
    if (blank) {
      setError(t('admin.settings.errEmpty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await updateSetting(setting.key, draft.trim(), setting.version, token);
      onSaved(saved, t('admin.settings.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Another Super Admin changed it while this form was open. Reloading is
        // the only correct response — for a consent text version, a silent
        // overwrite is a compliance question, not just a lost edit.
        onConflict(t('common.conflict'));
        return;
      }
      setError(
        err instanceof ApiError && err.status === 400
          ? t('admin.settings.errRejected')
          : t('common.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-item">
      {/* **The control the SERVER named** (2026-08-17). The allow-list gained
          integer settings — the grading scale, which §7 has always described as
          runtime-editable — and a number typed into a free-text field is a number
          the server has to refuse after the fact. `NumberField` is the platform's
          own integer control, so the keyboard, the spinner and the mobile numeric
          pad come with it; the kind travels on the wire because *which settings
          are writable* is already a server decision and a client inferring the
          control from the key would be a second copy of it. */}
      {setting.kind === 'integer' ? (
        <NumberField
          label={t(setting.label_key)}
          value={draft}
          onChange={setDraft}
          required
          min={0}
          hint={t(setting.hint_key)}
          error={error}
        />
      ) : (
        <TextField
          label={t(setting.label_key)}
          value={draft}
          onChange={setDraft}
          required
          hint={t(setting.hint_key)}
          error={error}
        />
      )}
      <p className="settings-item__meta">
        {setting.value === null ? (
          // Never configured is a different fact from "set to something" and is
          // the state that stops registration entirely — so it is called out.
          <span className="badge badge--warn">{t('admin.settings.notConfigured')}</span>
        ) : (
          <span className="muted">
            {t('admin.settings.current').replace('{value}', setting.value)}
          </span>
        )}
      </p>
      <div className="settings-item__actions">
        <Button
          variant="primary"
          disabled={busy || blank || draft.trim() === (setting.value ?? '')}
          onClick={() => void save()}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </section>
  );
}

/**
 * **The versioned legal consent wording** (R119) — `صيغ نص الموافقة القانوني`.
 *
 * Three things an administrator needs to see at once, and the order is the
 * order of importance:
 *
 * 1. **What is in force**, with its exact Arabic wording and the date it took
 *    effect — because *«which wording will the next applicant see»* is the
 *    question this screen exists to answer.
 * 2. **That there is none**, when there is none, in place of the content rather
 *    than beside it (rule AH): it is the state in which no registration can be
 *    accepted at all.
 * 3. **The earlier versions, read-only.** Not hidden behind a toggle: a
 *    compliance reader arrives here asking *«what did somebody agree to in
 *    March»*, and an accordion would hide the answer behind a click nobody
 *    knows to make.
 */
function ConsentTextsSection(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<ConsentTextVersion[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<ConsentTextVersion | 'new' | null>(null);
  const [confirming, setConfirming] = useState<ConsentTextVersion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await listConsentTexts(accessToken));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = rows.find((r) => r.status === 'active') ?? null;
  const drafts = rows.filter((r) => r.status === 'draft');
  const history = rows.filter((r) => r.status === 'superseded');

  async function activate(row: ConsentTextVersion): Promise<void> {
    setBusy(true);
    try {
      await activateConsentText(row.id, accessToken);
      setConfirming(null);
      setNotice(t('admin.consentText.activated'));
      await load();
    } catch {
      setNotice(t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-item">
      <h2>{t('admin.consentText.title')}</h2>
      <p className="settings-item__meta muted">{t('admin.consentText.lede')}</p>

      {notice ? <Feedback>{notice}</Feedback> : null}

      {status === 'error' ? (
        <ErrorState onRetry={() => void load()} />
      ) : status === 'loading' ? (
        <div className="skeleton" aria-live="polite" />
      ) : (
        <>
          {active === null ? (
            /* Rule AH — a page-level condition, in place of the content. This
               is the state in which registration is refused outright, so it is
               a warning rather than an empty list. */
            <p className="field__error" role="alert">
              {t('admin.consentText.noneActive')}
            </p>
          ) : (
            <VersionCard row={active} heading={t('admin.consentText.inForce')} />
          )}

          {drafts.map((row) => (
            <VersionCard
              key={row.id}
              row={row}
              heading={t('admin.consentText.draft')}
              onEdit={() => setEditing(row)}
              onActivate={() => setConfirming(row)}
            />
          ))}

          <div className="settings-item__actions">
            {/* `variant="add"` owns the ＋ glyph; a label must never carry it. */}
            <Button variant="add" onClick={() => setEditing('new')}>
              {t('admin.consentText.add')}
            </Button>
          </div>

          {history.length > 0 ? (
            <>
              <h3>{t('admin.consentText.historyTitle')}</h3>
              {/* Read-only, and visible without a click: a compliance reader
                  arrives asking what somebody agreed to on a given date. */}
              <p className="settings-item__meta muted">{t('admin.consentText.historyHint')}</p>
              {history.map((row) => (
                <VersionCard key={row.id} row={row} heading={t('admin.consentText.superseded')} />
              ))}
            </>
          ) : null}
        </>
      )}

      <ConsentTextDialog
        row={editing}
        token={accessToken}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          setNotice(message);
          void load();
        }}
      />

      <ConfirmDialog
        open={confirming !== null}
        title={t('admin.consentText.activateTitle')}
        body={t('admin.consentText.activateBody').replace(
          '{label}',
          confirming?.version_label ?? '',
        )}
        confirmLabel={t('admin.consentText.activateConfirm')}
        busy={busy}
        onConfirm={() => void (confirming && activate(confirming))}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}

/**
 * One version, **with its wording in full**.
 *
 * Truncating it would reproduce the detached-string screen this replaces: the
 * whole point is that an administrator can read what a version actually says.
 * `white-space: pre-line` keeps the stored paragraph breaks, which are part of
 * what was approved.
 */
function VersionCard({
  row,
  heading,
  onEdit,
  onActivate,
}: {
  row: ConsentTextVersion;
  heading: string;
  onEdit?: () => void;
  onActivate?: () => void;
}): ReactNode {
  return (
    <article className="consent-version">
      <h3 className="consent-version__heading">
        {heading} — {row.version_label}
      </h3>
      <p className="settings-item__meta muted">
        {row.activated_at
          ? t('admin.consentText.activatedOn').replace('{date}', row.activated_at.slice(0, 10))
          : t('admin.consentText.neverActivated')}
        {row.consent_record_count > 0
          ? ` · ${t('admin.consentText.usedCount').replace(
              '{count}',
              String(row.consent_record_count),
            )}`
          : ''}
      </p>
      <p className="consent-version__body">{row.body_arabic}</p>
      {onEdit || onActivate ? (
        <div className="settings-item__actions">
          {onEdit ? <Button onClick={onEdit}>{t('common.edit')}</Button> : null}
          {onActivate ? (
            <Button variant="primary" onClick={onActivate}>
              {t('admin.consentText.activate')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {row.status !== 'draft' ? (
        /**
         * **Rule AF — shown as a fact, not as a disabled control.** A greyed-out
         * «تعديل» invites somebody to hunt for the permission that would enable
         * it; this says what the rule is and where the next wording comes from.
         */
        <p className="settings-item__meta muted">{t('admin.consentText.immutable')}</p>
      ) : null}
    </article>
  );
}

/** Create a draft, or correct one that has never been in force. */
function ConsentTextDialog({
  row,
  token,
  onClose,
  onSaved,
}: {
  row: ConsentTextVersion | 'new' | null;
  token: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const existing = row === 'new' || row === null ? null : row;
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fields are written after the first render, so the pristine side is read
  // from the row rather than captured — see `lib/form-dirty.ts`.
  useEffect(() => {
    setLabel(existing?.version_label ?? '');
    setBody(existing?.body_arabic ?? '');
    setError(null);
  }, [existing]);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await updateConsentText(
          existing.id,
          { version_label: label.trim(), body_arabic: body },
          existing.version,
          token,
        );
      } else {
        await createConsentText({ version_label: label.trim(), body_arabic: body }, token);
      }
      onSaved(t('admin.consentText.saved'));
    } catch (err) {
      setError(
        err instanceof ApiError && err.details['reason'] === 'CONSENT_TEXT_VERSION_LABEL_TAKEN'
          ? t('admin.consentText.errLabelTaken')
          : err instanceof ApiError && err.details['reason'] === 'CONSENT_TEXT_IMMUTABLE'
            ? t('admin.consentText.errImmutable')
            : t('common.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={row !== null}
      title={existing ? t('admin.consentText.editTitle') : t('admin.consentText.addTitle')}
      wide
      submitLabel={t('common.save')}
      busy={busy}
      disabled={label.trim() === '' || body.trim() === ''}
      // Rule U — unsaved legal wording is the most expensive draft on the
      // platform to lose, and `dirty` defaults to false if it is not passed.
      dirty={
        label !== (existing?.version_label ?? '') || body !== (existing?.body_arabic ?? '')
      }
      notice={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextField
        label={t('admin.consentText.labelField')}
        value={label}
        onChange={setLabel}
        required
        hint={t('admin.consentText.labelHint')}
      />
      <TextArea
        label={t('admin.consentText.bodyField')}
        value={body}
        onChange={setBody}
        required
        rows={12}
        hint={t('admin.consentText.bodyHint')}
      />
    </FormDialog>
  );
}
