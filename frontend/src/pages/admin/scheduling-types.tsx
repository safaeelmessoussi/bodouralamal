import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createSchedulingType,
  deleteSchedulingType,
  listSchedulingTypes,
  reorderSchedulingTypes,
  updateSchedulingType,
  type SchedulingTypeRow,
} from '../../adapters/scheduling-catalogue.js';
import type { SchedulingType } from '../../adapters/scheduling.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { BlockedNotice } from '../../components/ui/blocked-notice.js';
import { classifyDeletion, deletionNotice } from '../../lib/deletion-outcome.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { SelectField, TextField } from '../../components/ui/field.js';
import { Feedback } from '../../components/ui/feedback.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { isDirty } from '../../lib/form-dirty.js';

/**
 * **أنواع الجدولة — the scheduling-type catalogue** (R110, NEW H).
 *
 * ## Why this screen exists
 *
 * The five types an administrator picks from on الجدولة were a hardcoded
 * frontend constant: unrenameable, unorderable, unextendable, and silent about
 * which of them takes attendance. *Seeded does not mean immutable* (Owner
 * addendum) — **if the platform shows business data to users, there is a
 * management path for it.**
 *
 * ## Super Admin, and the heading stays truthful
 *
 * OD-01's final sub-decision keeps scheduling types Super-Admin-only until an
 * Owner decision delegates them, which is also what keeps R105's الإدارة heading
 * a fact about permission rather than a label. The controls follow the **active**
 * role (R60) — a Super Admin working as مؤطِّرة is not offered a write the server
 * will refuse — and **the server enforces it regardless**: this gating is UX,
 * never the boundary (rule O).
 *
 * ## What cannot be edited, and why the form says so
 *
 * `structural_kind` is chosen once. It decides which entity the type routes to,
 * so changing it would re-point every activity recorded against the row at a
 * model that cannot represent them — the reasoning §4.4 applies to a schedule's
 * subject and §4.6 to an exam's level. The API refuses the key outright, so on
 * edit it is shown **as text with the reason**, not as a disabled control
 * pretending to be one (rule AF).
 */
const KIND_KEYS: Record<SchedulingType, string> = {
  class: 'scheduling.type.class',
  activity: 'scheduling.type.activity',
  exam: 'scheduling.type.exam',
  holiday: 'scheduling.type.holiday',
};

/** Which entity a row is delivered by, in the reader's words. */
function kindLabel(kind: SchedulingType): string {
  return t(KIND_KEYS[kind]);
}

export function SchedulingTypesPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role, never the account's full list.
  const canWrite = activeRoles.includes('super_admin');

  const [rows, setRows] = useState<SchedulingTypeRow[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SchedulingTypeRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SchedulingTypeRow | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await listSchedulingTypes(accessToken));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    input: { name: string; structural_kind: SchedulingType; attendance_required: boolean },
    existing: SchedulingTypeRow | null,
  ): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (existing) {
        // `structural_kind` is deliberately not sent on an edit — the API's
        // `.strict()` schema refuses it, and a client that sent it would be
        // proposing a change the server has no way to honour.
        await updateSchedulingType(
          existing.id,
          existing.version,
          { name: input.name, attendance_required: input.attendance_required },
          accessToken,
        );
      } else {
        await createSchedulingType(input, accessToken);
      }
      setEditing(null);
      await load();
      setNotice(t(existing ? 'common.saved' : 'common.created'));
    } catch (error) {
      // TD-15: a stale version means somebody else edited this row. Reloading is
      // the only correct response — never a silent overwrite.
      const conflict = error instanceof ApiError && error.status === 409;
      setNotice(t(conflict ? 'common.conflict' : 'common.saveFailed'));
      if (conflict) {
        setEditing(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await deleteSchedulingType(id, accessToken);
      await load();
      setNotice(t('common.deleted'));
    } catch (error) {
      // TD-5 refuses while an activity still names this type — the record of
      // what that activity WAS must survive tidying the catalogue. The dialog
      // stays open and names the dependency (rule AZ.1, NEW A).
      const outcome = classifyDeletion(error);
      if (outcome.kind === 'blocked') {
        setBlocked(error);
        setBusy(false);
        return;
      }
      /**
       * **`already-gone` is a success for the reader** (2026-08-27). The row she
       * asked to remove is not there, which is what she wanted; reporting
       * *«تعذّر الحذف»* said the opposite and made Delete look unreliable on any
       * page left open while somebody else worked.
       */
      if (outcome.kind === 'already-gone') await load();
      setNotice(deletionNotice(outcome));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const columns: Column<SchedulingTypeRow>[] = [
    {
      key: 'name',
      header: t('admin.schedulingTypes.colName'),
      cell: (r) => r.name,
    },
    {
      key: 'structural_kind',
      header: t('admin.schedulingTypes.colKind'),
      cell: (r) => kindLabel(r.structural_kind),
    },
    {
      key: 'attendance_required',
      header: t('admin.schedulingTypes.colAttendance'),
      // نعم / لا, exactly as the Owner's own table states it. A checkbox here
      // would read as a control on a row nobody is editing.
      cell: (r) => (r.attendance_required ? t('common.yes') : t('common.no')),
    },
    {
      key: 'event_count',
      header: t('admin.schedulingTypes.colInUse'),
      /**
       * **What makes a blocked deletion legible BEFORE it happens** (rule AZ.1).
       *
       * A type an activity still names cannot be deleted, and an administrator
       * meeting that refusal with no idea what it was about has nothing to act
       * on. The same reason `CategoryRef.levelCount` is on its list.
       */
      cell: (r) =>
        r.event_count === 0 ? (
          <span className="muted">{t('admin.schedulingTypes.unused')}</span>
        ) : (
          String(r.event_count)
        ),
    },
  ];

  const actions: RowAction<SchedulingTypeRow>[] = canWrite
    ? [
        { label: t('common.edit'), onSelect: (r) => setEditing(r) },
        { label: t('common.delete'), danger: true, onSelect: (r) => setDeleting(r) },
      ]
    : [];

  return (
    <AdminLayout
      title={t('admin.schedulingTypes.title')}
      lede={t('admin.schedulingTypes.lede')}
      actions={
        canWrite ? (
          <Button variant="add" onClick={() => setEditing('new')}>
            {t('admin.schedulingTypes.create')}
          </Button>
        ) : null
      }
    >
      {notice ? <Feedback>{notice}</Feedback> : null}

      <DataTable
        caption={t('admin.schedulingTypes.title')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        /* R76.8 — the order IS the sequence of rows, changed by dragging one.
           No «الترتيب» column: a number beside it would be a second way to say
           the same thing, and the two would disagree the first time either was
           used. */
        {...(canWrite
          ? { onReorder: async (ids: string[]) => reorderSchedulingTypes(ids, accessToken).then(load) }
          : {})}
      />

      {editing ? (
        <SchedulingTypeFormDialog
          initial={editing === 'new' ? null : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        {...(blocked
          ? { blocked: <BlockedNotice error={blocked} item={t('admin.schedulingTypes.thisItem')} /> }
          : {})}
        title={t('admin.schedulingTypes.deleteTitle')}
        body={t('admin.schedulingTypes.deleteBody').replace('{name}', deleting?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove(deleting!.id)}
        onCancel={() => {
          setDeleting(null);
          setBlocked(null);
        }}
      />
    </AdminLayout>
  );
}

function SchedulingTypeFormDialog({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: SchedulingTypeRow | null;
  busy: boolean;
  onSave: (input: {
    name: string;
    structural_kind: SchedulingType;
    attendance_required: boolean;
  }) => void;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<SchedulingType>(initial?.structural_kind ?? 'activity');
  const [attendance, setAttendance] = useState(initial?.attendance_required ?? false);
  const [touched, setTouched] = useState(false);
  const error = name.trim() === '' ? t('common.required') : null;

  // Every field the form holds — a `dirty` that missed one would let the
  // unsaved-changes guard throw away exactly the change just made (rule AY).
  const dirty = isDirty(
    { name, kind, attendance },
    {
      name: initial?.name ?? '',
      kind: initial?.structural_kind ?? 'activity',
      attendance: initial?.attendance_required ?? false,
    },
  );

  function submit(): void {
    setTouched(true);
    if (error) return;
    onSave({ name: name.trim(), structural_kind: kind, attendance_required: attendance });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={t(initial ? 'admin.schedulingTypes.edit' : 'admin.schedulingTypes.create')}
      busy={busy}
      dirty={dirty}
    >
      <TextField
        label={t('admin.schedulingTypes.colName')}
        value={name}
        onChange={setName}
        required
        error={touched ? error : null}
      />

      {initial ? (
        /**
         * **Shown as text, with the line that says which action does change it**
         * (rule AF). Removing the control would leave the route accepting the
         * field; the route refuses it instead, and the form explains rather than
         * disabling a select that looks editable.
         */
        <p className="field">
          <span className="field__label">{t('admin.schedulingTypes.colKind')}</span>
          <span>{kindLabel(kind)}</span>
          <span className="hint">{t('admin.schedulingTypes.kindFixed')}</span>
        </p>
      ) : (
        <SelectField
          label={t('admin.schedulingTypes.colKind')}
          value={kind}
          onChange={(v) => setKind(v as SchedulingType)}
          hint={t('admin.schedulingTypes.kindHint')}
          options={(['class', 'activity', 'exam'] as SchedulingType[]).map((k) => ({
            value: k,
            label: kindLabel(k),
          }))}
        />
      )}

      <label className="field field--choice">
        <input
          type="checkbox"
          checked={attendance}
          onChange={(e) => setAttendance(e.target.checked)}
        />
        <span>{t('admin.schedulingTypes.colAttendance')}</span>
      </label>
      <p className="hint">{t('admin.schedulingTypes.attendanceHint')}</p>
    </FormDialog>
  );
}
