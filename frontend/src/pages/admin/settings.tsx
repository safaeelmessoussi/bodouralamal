import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listSettings, updateSetting, type Setting } from '../../adapters/settings.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ErrorState } from '../../components/states.js';
import { Button } from '../../components/ui/button.js';
import { NumberField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/superadmin/settings` — Platform Settings, first iteration (§5.6, R42).
 *
 * **This screen is why registration works at all.**
 * `legal.consent_text_version` is required before any registration can be
 * accepted (§4.1a), §15.1 deliberately does not seed it (§2.3 makes versioning
 * the Arabic text an owner compliance task), and until now nothing in the
 * product could set it — a first deployment refused every applicant with no
 * in-product remedy. A development fixture is not a production mechanism.
 *
 * **The screen renders what the server lists.** Which settings are writable is
 * a server-side allow-list, and the labels arrive as i18n *keys* the backend
 * chooses. A client holding its own list would drift the first time one was
 * added — and would let someone try to write a key the server does not accept.
 *
 * **Changing a value affects future registrations only** (R42, normative).
 * Stored `ConsentRecord`s keep the version captured when consent was given;
 * restamping them would assert that people agreed to text they never saw. The
 * screen says so, because an administrator editing this needs to know it.
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
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

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
