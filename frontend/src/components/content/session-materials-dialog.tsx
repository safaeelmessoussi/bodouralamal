import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchSessionPage, type SessionContentRef } from '../../adapters/calendar.js';
import { linkSessionContent, unlinkSessionContent } from '../../adapters/sessions.js';
import { t } from '../../i18n/index.js';
import { api } from '../../lib/api.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';
import { SearchableSelect } from '../ui/searchable-select.js';
import { FileUploader } from './file-uploader.js';

/**
 * The materials attached to one Session (§4.9, TD-3.12).
 *
 * **Content is referenced by a session, never owned by it** (Revision 43), and
 * this dialog is built around that distinction rather than in spite of it:
 *
 * * **Link an existing item** is the primary action, because the semester PDF
 *   belongs to the Subject and is referenced by every session that uses it.
 * * **Upload a new one** is a shortcut that does two things in order — creates
 *   the library item in the session's Level/Subject scope, then links it. The
 *   file lands in the library either way; it is not a session-owned attachment.
 * * **Remove** unlinks and **never deletes the file** (TD-3.12): the item has
 *   its own lifecycle, and destroying it for every other session that
 *   references it is not what "remove from this session" means.
 *
 * Uploading through here also changes what a later schedule edit may do: a
 * session carrying a content link is **protected** (R43.6), so it will be spared
 * and reported rather than rewritten.
 */
export interface SessionMaterialsProps {
  sessionId: string | null;
  /** The session's teaching scope, so an upload lands where the class is. */
  scope: { levelId: string; subjectId: string; academicYearId: string; branchId: string | null };
  token: string | null;
  onClose: () => void;
}

interface LibraryOption {
  id: string;
  title: string;
}

export function SessionMaterialsDialog({
  sessionId,
  scope,
  token,
  onClose,
}: SessionMaterialsProps): ReactNode {
  const [linked, setLinked] = useState<SessionContentRef[]>([]);
  const [recordings, setRecordings] = useState<SessionContentRef[]>([]);
  const [options, setOptions] = useState<LibraryOption[]>([]);
  const [choice, setChoice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const page = await fetchSessionPage(sessionId);
    setLinked(page.linked_content);
    setRecordings(page.recordings);
    // The candidates are the library items in this session's own Level and
    // Subject — the ones a teacher would plausibly attach. A full library list
    // would make the picker a search problem the dialog is not.
    const body = await api<{ data: LibraryOption[] }>(
      `/library?level_id=${encodeURIComponent(scope.levelId)}&subject_id=${encodeURIComponent(
        scope.subjectId,
      )}&page_size=100`,
      { token },
    );
    setOptions(body.data);
  }, [sessionId, scope.levelId, scope.subjectId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch {
      setError(t('session.materialsFailed'));
    } finally {
      setBusy(false);
    }
  }

  const attached = new Set([...linked, ...recordings].map((c) => c.id));

  return (
    <Dialog
      open={sessionId !== null}
      onClose={onClose}
      title={t('session.materialsTitle')}
      wide
    >
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <MaterialList
        title={t('session.materials')}
        items={linked}
        busy={busy}
        onRemove={(id) => void run(() => unlinkSessionContent(sessionId ?? '', id, token))}
      />
      {/* §4.9 keeps recordings distinct from materials; they are removed the
          same way, and unlinking a recording no more deletes it than any other. */}
      <MaterialList
        title={t('session.recordings')}
        items={recordings}
        busy={busy}
        onRemove={(id) => void run(() => unlinkSessionContent(sessionId ?? '', id, token))}
      />

      {/* **The picker-plus-action shape the platform already has** (2026-08-17).
          This was `.form__row` — a two-column grid meant for two FIELDS — holding
          a `SelectField` and a bare button. `align-items: start` then lined the
          button up with the select's *label* rather than its control, which is
          what made it look wrong; and the picker was a `SelectField` over up to a
          hundred library items, where rule E asks for the searchable control.

          It is now exactly what `مستفيدات المجموعة` and the circle roster use:
          `SearchableSelect`, then the action in `form__actions`. No new class, no
          new style — the alignment comes from the shape being right. */}
      <SearchableSelect
        label={t('session.materialsLinkExisting')}
        // Already-attached items are absent rather than disabled: the list
        // answers *what can I add*, and an option that does nothing is noise.
        options={options
          .filter((o) => !attached.has(o.id))
          .map((o) => ({ value: o.id, label: o.title }))}
        value={choice}
        onChange={setChoice}
        emptyLabel={t('session.materialsNoneToAdd')}
        disabled={busy}
      />
      <div className="form__actions">
        <Button
          variant="add"
          disabled={busy || choice === '' || sessionId === null}
          onClick={() =>
            void run(async () => {
              await linkSessionContent(sessionId ?? '', choice, token);
              setChoice('');
            })
          }
        >
          {t('session.materialsLink')}
        </Button>
      </div>

      {uploading ? (
        <FileUploader
          meta={{
            level_id: scope.levelId,
            subject_id: scope.subjectId,
            academic_year_id: scope.academicYearId,
            branch_id: scope.branchId,
          }}
          token={token}
          submitLabel={t('content.upload.action')}
          onCancel={() => setUploading(false)}
          onUploaded={(contentId) =>
            void run(async () => {
              // Upload then link, in that order: the item exists in the library
              // regardless, and a failed link leaves a usable file rather than
              // an orphaned upload.
              await linkSessionContent(sessionId ?? '', contentId, token);
              setUploading(false);
            })
          }
        />
      ) : (
        <Button variant="secondary" onClick={() => setUploading(true)} disabled={busy}>
          {t('session.materialsUploadNew')}
        </Button>
      )}
    </Dialog>
  );
}

function MaterialList({
  title,
  items,
  busy,
  onRemove,
}: {
  title: string;
  items: SessionContentRef[];
  busy: boolean;
  onRemove: (id: string) => void;
}): ReactNode {
  return (
    <section className="materials">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">{t('session.materialsNone')}</p>
      ) : (
        <ul className="materials__list">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.title}</span>
              <Button variant="ghost" disabled={busy} onClick={() => onRemove(item.id)}>
                {t('session.materialsRemove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
