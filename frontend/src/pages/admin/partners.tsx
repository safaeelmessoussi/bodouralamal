import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createPartner,
  deletePartner,
  listPartners,
  updatePartner,
  type Partner,
  type PartnerInput,
} from '../../adapters/partners.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { Feedback } from '../../components/ui/feedback.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { isDirty } from '../../lib/form-dirty.js';
import { classifyDeletion } from '../../lib/deletion-outcome.js';

/**
 * `/admin/partners` — **شركاء بذور الأمل** (NEW N).
 *
 * Reference data a **Super Admin** owns (OD-01's sub-decision: *scheduling types
 * · Partners* stay undelegated until a later Owner decision). **The node's
 * visibility is not the control** — the service refuses an Admin every read and
 * every write regardless of what the menu shows.
 *
 * ## Why «الظهور» is a column and not a second delete
 *
 * A partner can be **withheld from the public site without the record being
 * withdrawn**, which is what an association actually needs while a relationship
 * is being renewed. Deleting instead would lose the row; leaving it visible
 * would publish a claim that is no longer true. Two questions, two controls —
 * and the table shows both, so «not on the site» is never mistaken for «deleted»
 * (rule BA).
 *
 * ## What is deliberately absent
 *
 * No logo, no URL, no description, no contact. A partner is a **name**; a column
 * exists for a fact the platform holds rather than one it might, and an empty
 * logo frame on a public page is worse than no frame at all.
 */
export function PartnersPage(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<Partner[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Partner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(await listPartners(accessToken));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<Partner>[] = [
    { key: 'name', header: t('admin.partners.colName'), cell: (r) => r.name },
    {
      // §8/rule BA — the fact that decides whether the landing page shows them.
      key: 'visible',
      header: t('admin.partners.colVisible'),
      cell: (r) =>
        r.is_visible ? t('admin.partners.visible') : t('admin.partners.hidden'),
    },
  ];

  const actions: RowAction<Partner>[] = [
    { label: t('common.edit'), onSelect: (r) => setEditing(r) },
    { label: t('common.delete'), danger: true, onSelect: (r) => setDeleting(r) },
  ];

  async function save(input: PartnerInput, target: Partner | null): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (target) await updatePartner(target.id, target.version, input, accessToken);
      else await createPartner(input, accessToken);
      setEditing(null);
      await load();
    } catch {
      setNotice(t('admin.partners.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout title={t('admin.nav.partners')} lede={t('admin.partners.lede')}>
      {notice === null ? null : <Feedback>{notice}</Feedback>}

      <div className="register-form__actions">
        <Button variant="add" onClick={() => setEditing('new')}>
          {t('admin.partners.create')}
        </Button>
      </div>

      <DataTable
        caption={t('admin.partners.caption')}
        rows={rows}
        columns={columns}
        actions={actions}
        status={status}
        rowKey={(r) => r.id}
        onRetry={() => void load()}
      />

      {editing === null ? null : (
        <PartnerFormDialog
          partner={editing === 'new' ? null : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.partners.deleteTitle')}
        body={t('admin.partners.deleteBody').replace('{name}', deleting?.name ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          void (async () => {
            setBusy(true);
            const outcome = await classifyDeletion(() =>
              deletePartner(deleting!.id, accessToken),
            );
            setBusy(false);
            setDeleting(null);
            // The shared classifier, so «already gone» reads as success and a
            // refusal never renders as a generic failure.
            if (outcome.kind === 'deleted' || outcome.kind === 'already-gone') {
              setNotice(t('admin.partners.deleted'));
              await load();
            } else {
              setNotice(t('admin.partners.deleteFailed'));
            }
          })();
        }}
      />
    </AdminLayout>
  );
}

/** Name and visibility — the whole entity, so the whole form (rule AX). */
function PartnerFormDialog({
  partner,
  busy,
  onSave,
  onCancel,
}: {
  partner: Partner | null;
  busy: boolean;
  onSave: (input: PartnerInput) => void;
  onCancel: () => void;
}): ReactNode {
  const pristine = {
    name: partner?.name ?? '',
    visible: partner === null ? 'true' : String(partner.is_visible),
  };
  const [form, setForm] = useState(pristine);
  const [touched, setTouched] = useState(false);
  const error = form.name.trim() === '' ? t('common.required') : null;
  const dirty = isDirty(form, pristine);

  return (
    <FormDialog
      open
      title={t(partner ? 'admin.partners.editTitle' : 'admin.partners.create')}
      submitLabel={t('common.save')}
      busy={busy}
      dirty={dirty}
      onCancel={onCancel}
      onSubmit={() => {
        setTouched(true);
        if (error) return;
        onSave({ name: form.name.trim(), is_visible: form.visible === 'true' });
      }}
    >
      <TextField
        label={t('admin.partners.colName')}
        value={form.name}
        onChange={(v) => setForm((f) => ({ ...f, name: v }))}
        required
        error={touched ? error : null}
      />
      <SelectField
        label={t('admin.partners.colVisible')}
        value={form.visible}
        onChange={(v) => setForm((f) => ({ ...f, visible: v }))}
        options={[
          { value: 'true', label: t('admin.partners.visible') },
          { value: 'false', label: t('admin.partners.hidden') },
        ]}
        hint={t('admin.partners.visibleHint')}
      />
    </FormDialog>
  );
}
