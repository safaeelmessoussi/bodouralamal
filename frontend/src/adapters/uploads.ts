import { api } from '../lib/api.js';

/**
 * The TD-3.5 upload flow, from the client's side (§4.9, TD-9, R53).
 *
 * **Three requests, and only the middle one carries the file.** `initiate`
 * returns a presigned URL, the browser PUTs **straight to storage** through it,
 * and `complete` asks the server to verify what actually arrived. The file never
 * passes through the API — which is why progress has to be measured on the PUT
 * and cannot come from an API response.
 *
 * **`XMLHttpRequest`, deliberately, for that one request.** `fetch` reports
 * download progress and not upload progress: `ReadableStream` request bodies are
 * not supported widely enough to rely on, and §14.7's matrix includes iOS
 * Safari. Since MVP uploads are single-shot with no resume (§4.9, Risk R-9),
 * **a progress bar and a clean retry are the mitigation** — so the one browser
 * API that can actually report it is worth the older shape.
 */

export type UploadStage = 'idle' | 'preparing' | 'uploading' | 'finalising' | 'done' | 'failed';

export interface UploadMeta {
  level_id: string;
  subject_id: string;
  academic_year_id: string;
  /** `null` is the Global / بدون فرع scope (§4.9) — a real value only an Admin
   *  may choose, never a stand-in for "not set". */
  branch_id: string | null;
  visibility?: 'public' | 'private' | 'hidden';
  /**
   * **R99.12 — *this is a class recording*, stated at the boundary.**
   *
   * «التسجيلات» is decided by `origin` and no longer by the MIME type (R99.10),
   * so a مؤطِّرة's phone recording has to be able to say what it is or it would
   * arrive as a *material*. It states what the thing is and grants nothing:
   * `video/*` is refused here whatever this says.
   */
  origin?: 'uploaded' | 'session_recording';
  /** R53: replaces the file on this record — a new key, the old object
   *  quarantined, the record and every link to it kept. */
  replaces_content_id?: string;
}

interface InitiateResponse {
  upload_id: string;
  key: string;
  put_url: string;
  expires_in: number;
}

/**
 * Uploads one file and returns the content id.
 *
 * `onProgress` receives 0–100 for the PUT only. The two API calls around it are
 * small and fast; showing them as progress would make the bar jump to 5% and sit
 * there, which reads as a stall rather than as work.
 */
export async function uploadFile(
  file: File,
  meta: UploadMeta,
  fields: { title: string; description: string | null },
  token: string | null,
  onProgress: (percent: number) => void,
  onStage: (stage: UploadStage) => void,
): Promise<string> {
  onStage('preparing');
  const initiated = await api<InitiateResponse>('/uploads/initiate', {
    token,
    method: 'POST',
    body: {
      filename: file.name,
      size: file.size,
      // A browser that cannot identify the file sends `''`. Passing it through
      // lets the server refuse it against TD-9's whitelist with a message about
      // the type, rather than the client inventing one and failing the
      // magic-byte check later for a reason nobody can act on.
      mime: file.type,
      content_meta: meta,
    },
  });

  onStage('uploading');
  try {
    await putWithProgress(initiated.put_url, file, onProgress);
  } catch (error) {
    // The object may be half-written; telling the server lets it clean up now
    // rather than leaving it for `upload.gc` 48 hours later.
    await abortUpload(initiated.upload_id, token);
    onStage('failed');
    throw error;
  }

  onStage('finalising');
  const created = await api<{ id: string }>(
    `/uploads/${encodeURIComponent(initiated.upload_id)}/complete`,
    { token, method: 'POST', body: fields },
  );
  onStage('done');
  return created.id;
}

export async function abortUpload(uploadId: string, token: string | null): Promise<void> {
  try {
    await api(`/uploads/${encodeURIComponent(uploadId)}/abort`, { token, method: 'POST' });
  } catch {
    // Abort is a courtesy: the server sweeps abandoned objects anyway (TD-7),
    // and failing here would replace the real upload error with this one.
  }
}

/** R53 — soft delete; the object waits out BR-15's window in quarantine. */
/**
 * **What the item IS — never the file it holds** (UAT, 2026-09-02).
 *
 * `PATCH /content/{id}` corrects a title, a Level, a Subject or a visibility
 * without re-uploading anything. Replacement is a different act with a
 * different route: this one cannot carry a file and the server refuses a body
 * that tries.
 *
 * Only the changed fields are sent, so an edit never restates values the
 * administrator did not touch.
 */
export interface ContentMetadataPatch {
  title?: string;
  level_id?: string;
  subject_id?: string;
  visibility?: 'public' | 'private' | 'hidden';
  /** R99.12's marker — «هذا تسجيل حصة». No storage meaning. */
  origin?: 'uploaded' | 'session_recording';
}

export async function updateContent(
  contentId: string,
  patch: ContentMetadataPatch,
  token: string | null,
): Promise<void> {
  await api(`/content/${encodeURIComponent(contentId)}`, {
    token,
    method: 'PATCH',
    body: patch,
  });
}

export async function deleteContent(contentId: string, token: string | null): Promise<void> {
  await api(`/content/${encodeURIComponent(contentId)}`, { token, method: 'DELETE' });
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.addEventListener('progress', (event) => {
      // `lengthComputable` is false for a body of unknown size; reporting 0 then
      // would make the bar reset to the start mid-upload.
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`storage responded ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('upload aborted')));
    xhr.send(file);
  });
}
