import { useEffect, useState, type ReactNode } from 'react';

import {
  fetchSessionRoster,
  setSessionAudienceBranches,
  type SessionRoster,
} from '../../adapters/sessions.js';
import { Badge } from '../ui/badge.js';
import { FormDialog } from '../ui/form-dialog.js';
import { isDirty } from '../../lib/form-dirty.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { t } from '../../i18n/index.js';

/**
 * **الحضور من الفروع — who is expected at THIS occurrence** (R92).
 *
 * The association occasionally delivers a lesson once instead of twice: two
 * branches' classes meet together, physically at one of them, for that
 * occurrence only.
 *
 * ## Two facts, never one control
 *
 * The dialog shows the **venue** as read-only text — *where the class meets* is
 * decided by the schedule and the room, and this screen does not change it — and
 * the **audience branches** as the thing being edited. They coincide for every
 * occurrence but the combined one, and separating them here is what stops an
 * administrator believing she has moved the class.
 *
 * ## Replacement, not addition
 *
 * The chosen list **is** the audience. To avoid the ambiguity an additive rule
 * would create — *does the schedule's own branch still count?* — the control
 * opens with the inherited branch **already selected**, so *combine* is
 * expressed by adding the second one. Clearing every branch removes the override
 * and the audience returns to the schedule's.
 *
 * ## This occurrence only
 *
 * Said on the screen, because *only this one* is precisely the thing an
 * administrator would otherwise have to infer from what did not change — the
 * same reasoning the one-off staffing dialog records.
 */
export function SessionAudienceDialog({
  sessionId,
  version,
  date,
  branches,
  onClose,
  onSaved,
  token,
}: {
  sessionId: string;
  version: number;
  date: string;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (message: string) => void;
  token: string | null;
}): ReactNode {
  const [roster, setRoster] = useState<SessionRoster | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void fetchSessionRoster(sessionId, token)
      .then((r) => {
        setRoster(r);
        // **Seeded with the inherited branch**, which is what makes
        // *replacement* the only rule anybody has to hold in their head.
        const ids = r.audience_branches.map((b) => b.id);
        setChosen(ids);
        setInitial(ids);
      })
      .catch(() => setNotice(t('admin.sessions.audienceLoadFailed')));
  }, [sessionId, token]);

  // Through the shared comparison rather than a hand-rolled join. Sorted first,
  // because the picker returns ids in click order and choosing A then B is the
  // same audience as choosing B then A — `isDirty` is deliberately
  // order-sensitive, so the sort is what makes it mean *changed*.
  const dirty = isDirty([...chosen].sort(), [...initial].sort());

  return (
    <FormDialog
      open
      title={t('admin.sessions.audienceTitle').replace('{date}', date)}
      notice={notice}
      busy={busy}
      dirty={dirty}
      onCancel={onClose}
      onSubmit={async () => {
        setBusy(true);
        try {
          await setSessionAudienceBranches(sessionId, version, chosen, token);
          onSaved(t('admin.sessions.audienceSaved'));
        } catch {
          setNotice(t('admin.sessions.audienceSaveFailed'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="field__hint">{t('admin.sessions.audienceHint')}</p>

      {/* **The venue, as text.** Where the class meets is not what this screen
          changes, and showing it as a control would say otherwise (rule AF's
          reasoning, applied to a field this dialog simply does not own). */}
      {roster ? (
        <p className="field__hint">
          <strong>{t('admin.sessions.audienceVenue')}</strong>{' '}
          {roster.venue.branch_name}
          {roster.venue.room_name ? ` — ${roster.venue.room_name}` : ''}
        </p>
      ) : null}

      <MultiSelectField
        label={t('admin.sessions.audienceBranches')}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        selected={chosen}
        onChange={setChosen}
        hint={t('admin.sessions.audienceBranchesHint')}
      />

      {roster ? (
        <p className="staff-picker__warnings">
          <Badge tone={roster.overridden ? 'warn' : 'neutral'}>
            {t('admin.sessions.audienceCount').replace(
              '{n}',
              String(roster.students.length),
            )}
          </Badge>
          {roster.overridden ? (
            <Badge tone="warn">{t('admin.sessions.audienceOverridden')}</Badge>
          ) : null}
        </p>
      ) : null}

      {/* The roster itself, so an administrator reads who is expected rather
          than inferring it from calendar behaviour. Each name carries the branch
          she comes from, which is what makes a combined list legible. */}
      {roster && roster.students.length > 0 ? (
        <ul className="multi-select__options">
          {roster.students.map((s) => (
            <li key={s.id}>
              {s.name}
              {s.branch_id ? (
                <span className="muted">
                  {' — '}
                  {branches.find((b) => b.id === s.branch_id)?.name ?? ''}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </FormDialog>
  );
}
