import { useEffect, useState, type ReactNode } from 'react';

import { fetchCalendarBootstrap } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import type { FramingPreferenceView } from '../../types/framing.js';
import {
  framingLevelOptions,
  framingPayload,
  teachingSectionFrom,
  TeachingSectionFields,
  validateTeachingSection,
  type FramingPayload,
  type TeachingSectionValue,
} from '../registration/role-sections.js';
import { Button } from '../ui/button.js';

/**
 * **R215 — the framing preference, edited** (the Owner, 2026-10-10: the
 * مؤطِّرة in her dashboard, and the administration, may say when, in which
 * position, remote or in class, in which branches and for which Levels). The
 * registration's own fields, so the three places ask the same questions; the
 * branches and Levels come from the public calendar bootstrap. Planning data:
 * saving it grants nothing.
 *
 * **R253 — `controlled`**: a page that saves everything with one «حفظ» (the
 * مؤطِّرة's «إدخال أوقات التوفّر») holds the value itself; the editor then draws
 * the fields only, with no button of its own.
 */
export function FramingPreferenceEditor({
  framing,
  onSave,
  controlled,
}: {
  framing: FramingPreferenceView | null;
  onSave?: (payload: FramingPayload) => Promise<FramingPreferenceView | null>;
  controlled?: { value: TeachingSectionValue; onChange: (next: TeachingSectionValue) => void; showErrors: boolean };
}): ReactNode {
  const [own, setOwn] = useState<TeachingSectionValue>(() => teachingSectionFrom(framing));
  const value = controlled ? controlled.value : own;
  const setValue = controlled ? controlled.onChange : setOwn;
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [levels, setLevels] = useState<{ id: string; label: string }[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => setOwn(teachingSectionFrom(framing)), [framing]);
  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    void fetchCalendarBootstrap({ from: today, to: today })
      .then((bootstrap) => {
        if (cancelled) return;
        setBranches(bootstrap.branches);
        setLevels(framingLevelOptions(bootstrap));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = validateTeachingSection(value);
  async function save(): Promise<void> {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setStatus(null);
    try {
      if (!onSave) return;
      const saved = await onSave(framingPayload(value));
      setValue(teachingSectionFrom(saved));
      setStatus(t('framing.saved'));
    } catch (error) {
      const reason = error instanceof ApiError ? (error.envelope?.details as { reason?: string } | undefined)?.reason : undefined;
      setStatus(
        reason === 'NO_CURRENT_YEAR'
          ? t('framing.noCurrentYear')
          : reason === 'NO_CURRENT_PERIOD'
            ? t('framing.noCurrentPeriod')
            : t('profile.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form framing-editor" data-framing-editor>
      <h2 className="form__legend">{t('framing.generalTitle')}</h2>
      <p className="field__hint">{t('framing.generalHintEditable')}</p>
      <TeachingSectionFields
        value={value}
        onChange={setValue}
        branches={branches}
        levels={levels}
        errors={(controlled ? controlled.showErrors : touched) ? errors : {}}
        notice={false}
      />
      {controlled ? null : (
        <div className="form__actions">
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t('framing.save')}
          </Button>
          {status ? (
            <span className="muted" role="status">
              {status}
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
