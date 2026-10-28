import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchRecordingSlides, saveRecordingSlides, type RecordingSlide } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { api } from '../../lib/api.js';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';
import { SearchableSelect } from '../ui/searchable-select.js';
import { FileUploader } from './file-uploader.js';

/** What the dialog needs of the recording: where its pages are filed. */
export interface SlidesRecording {
  id: string;
  title: string;
  level_id: string;
  subject_id: string | null;
  academic_year_id: string;
  branch_id: string | null;
  additional_branches?: { id: string }[];
  visibility: string;
  surah_id?: number | null;
}

/** The image types TD-9 admits — the picker's hint here (the server still checks). */
const IMAGES = 'image/jpeg,image/png,image/webp';

/**
 * **R247 — «صفحات المطبوع» of one recording** (the Owner, 2026-10-28). The
 * images «حسب السورة» shows beside it while it plays, in this order: uploaded
 * here (filed where the recording is: its Level, Subject, year, branches,
 * Surah and visibility) or picked from the library. Removing a page unlinks
 * it and never deletes the image. A whole session's pages are attached to the
 * session («مواد الحصة»), not here.
 */
export function RecordingSlidesDialog({
  recording,
  token,
  onClose,
}: {
  recording: SlidesRecording;
  token: string | null;
  onClose: () => void;
}): ReactNode {
  const [slides, setSlides] = useState<RecordingSlide[]>([]);
  const [images, setImages] = useState<{ id: string; title: string }[]>([]);
  const [choice, setChoice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSlides(await fetchRecordingSlides(recording.id, token));
    // The candidates: this Level's images about the same Surah.
    const surah = recording.surah_id ? `&surah_id=${String(recording.surah_id)}` : '';
    const body = await api<{ data: { id: string; title: string; mime_type: string }[] }>(
      `/library?level_id=${encodeURIComponent(recording.level_id)}${surah}&page_size=100`,
      { token },
    );
    setImages(body.data.filter((item) => item.mime_type.startsWith('image/')));
  }, [recording.id, recording.level_id, recording.surah_id, token]);

  useEffect(() => {
    void load().catch(() => setError(t('content.slides.failed')));
  }, [load]);

  async function save(ids: string[]): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSlides(await saveRecordingSlides(recording.id, ids, token));
    } catch {
      setError(t('content.slides.failed'));
    } finally {
      setBusy(false);
    }
  }

  const ids = slides.map((slide) => slide.id);
  const move = (index: number, by: -1 | 1): void => {
    const next = [...ids];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    void save(next);
  };
  const branchIds =
    recording.branch_id === null
      ? []
      : [recording.branch_id, ...(recording.additional_branches ?? []).map((b) => b.id)];

  // An image picked but not yet added is unsaved work, as in «مواد الحصة».
  const guard = useUnsavedGuard({ open: true, dirty: choice !== '', busy, onCancel: onClose });

  return (
    <Dialog
      open
      onClose={guard.requestClose}
      dismissible={guard.dismissible}
      title={t('content.slides.title')}
      wide
    >
      {guard.confirmation}
      <p className="field__hint">{t('content.slides.hint')}</p>
      <p className="recording-slides__recording">{recording.title}</p>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="materials">
        {slides.length === 0 ? (
          <p className="muted">{t('content.slides.none')}</p>
        ) : (
          <ol className="materials__list recording-slides__list">
            {slides.map((slide, index) => (
              <li key={slide.id}>
                <span>{slide.title}</span>
                <span className="recording-slides__actions">
                  <Button variant="ghost" disabled={busy || index === 0} onClick={() => move(index, -1)}>
                    {t('content.slides.earlier')}
                  </Button>
                  <Button variant="ghost" disabled={busy || index === slides.length - 1} onClick={() => move(index, 1)}>
                    {t('content.slides.later')}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void save(ids.filter((id) => id !== slide.id))}>
                    {t('content.slides.remove')}
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {slides.length > 0 ? <p className="field__hint">{t('content.slides.removeHint')}</p> : null}
      </section>

      <SearchableSelect
        label={t('content.slides.linkExisting')}
        options={images.filter((image) => !ids.includes(image.id)).map((image) => ({ value: image.id, label: image.title }))}
        value={choice}
        onChange={setChoice}
        emptyLabel={t('content.slides.noImages')}
        disabled={busy}
      />
      <div className="form__actions">
        <Button
          variant="add"
          disabled={busy || choice === ''}
          onClick={() =>
            void save([...ids, choice]).then(() => {
              setChoice('');
            })
          }
        >
          {t('content.slides.add')}
        </Button>
      </div>

      {uploading ? (
        <FileUploader
          meta={{
            level_id: recording.level_id,
            subject_id: recording.subject_id,
            academic_year_id: recording.academic_year_id,
            branch_ids: branchIds,
            visibility: recording.visibility as 'public' | 'private' | 'hidden',
            ...(recording.surah_id ? { surah_id: recording.surah_id } : {}),
          }}
          accept={IMAGES}
          suggestedTitle={`${t('content.slides.pageTitle')} — ${recording.title}`.slice(0, 110)}
          token={token}
          submitLabel={t('content.slides.upload')}
          onCancel={() => setUploading(false)}
          onUploaded={(uploaded) =>
            void save([...ids, ...uploaded]).then(async () => {
              setUploading(false);
              await load();
            })
          }
        />
      ) : (
        <Button variant="secondary" onClick={() => setUploading(true)} disabled={busy}>
          {t('content.slides.upload')}
        </Button>
      )}
    </Dialog>
  );
}
