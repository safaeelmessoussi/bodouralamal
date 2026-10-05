import { api, ApiError } from '../lib/api.js';

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
  /** R172 §1 — a Level, or (`category_id`) a whole Category with no Level:
   *  exactly one of the two travels to `/uploads/initiate`. */
  level_id?: string;
  category_id?: string;
  /** R195 — `null` is «عام» (TD-5's General): material of a class of all its
   *  Level's Subjects. Required and explicitly nullable, like `branch_id`. */
  subject_id: string | null;
  academic_year_id: string;
  /** `null` is the Global scope (§4.9) — a real value only an Admin may
   *  choose, never a stand-in for "not set". Name this OR `branch_ids`. */
  branch_id?: string | null;
  /** R198 §2 — the branches the item is filed for, home first; `[]` is Global. */
  branch_ids?: string[];
  visibility?: 'public' | 'private' | 'hidden';
  /** R177 §7 — the one Surah the item is about (1–114); absent means none. */
  surah_id?: number;
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
 * **R199 §1 — a dropped connection is retried here, not by the person.**
 *
 * The Owner uploaded twenty recordings on a phone connection and had to press
 * «إعادة المحاولة» again and again. Each phase now retries on its own while
 * the failure is the network's (no response, or a 5xx from the edge), with a
 * growing wait, and waits for the browser to be online again first: initiate
 * is safe to repeat (a new ticket), the PUT repeats onto the same presigned
 * URL (a fresh ticket once that URL is refused), and completion repeats with
 * the SAME ticket — the server finalises a ticket once (`publishedFinalization`),
 * so a reply lost after success can never create the item twice. A refusal
 * (4xx: type, size, scope, quota) is not retried: it would refuse again.
 */
export interface RetryPolicy {
  /** Tries per phase, the first included. */
  attempts: number;
  /** Told before each wait, so the screen can say what is happening. */
  onRetry?: (attempt: number, waitMs: number) => void;
}

const NO_RETRY: RetryPolicy = { attempts: 1 };

function retryable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 0 || error.status >= 500;
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the browser reports a connection (at once when it already does). */
function online(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
}

async function retrying<T>(run: () => Promise<T>, policy: RetryPolicy, beforeRetry?: (error: unknown) => Promise<void>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!retryable(error) || attempt >= policy.attempts) throw error;
      const waitMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
      policy.onRetry?.(attempt, waitMs);
      await sleep(waitMs);
      await online();
      if (beforeRetry) await beforeRetry(error);
    }
  }
}

/** The PUT was answered with a refusal — most often a presigned URL that expired. */
class StorageRefused extends Error {}

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
  retry: RetryPolicy = NO_RETRY,
): Promise<string> {
  onStage('preparing');
  const initiate = (): Promise<InitiateResponse> =>
    api<InitiateResponse>('/uploads/initiate', {
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
  let initiated = await retrying(initiate, retry);

  onStage('uploading');
  try {
    await retrying(
      async () => {
        onProgress(0);
        await putWithProgress(initiated.put_url, file, onProgress);
      },
      retry,
      async (error) => {
        // A refused PUT (an expired URL): the next try gets a fresh ticket.
        if (error instanceof StorageRefused) {
          await abortUpload(initiated.upload_id, token);
          initiated = await retrying(initiate, retry);
        }
      },
    );
  } catch (error) {
    // The object may be half-written; telling the server lets it clean up now
    // rather than leaving it for `upload.gc` 48 hours later.
    await abortUpload(initiated.upload_id, token);
    onStage('failed');
    throw error;
  }

  onStage('finalising');
  // The SAME ticket each time: completion is idempotent per ticket.
  const created = await retrying(
    () =>
      api<{ id: string }>(`/uploads/${encodeURIComponent(initiated.upload_id)}/complete`, {
        token,
        method: 'POST',
        body: fields,
      }),
    retry,
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
  /** R177 §7 — the one Surah; `null` clears it. */
  surah_id?: number | null;
  /** R167 §5 — addressed to every Level of its Level's Category. */
  whole_category?: boolean;
  /** R169 §10 — the item's OTHER Levels; REPLACES the set. `level_id` is its
   *  home and may not be repeated here (`LEVEL_IS_HOME`); each must teach the
   *  item's Subject (`SUBJECT_NOT_AT_LEVEL`). */
  additional_level_ids?: string[];
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
      else if (xhr.status >= 400 && xhr.status < 500) reject(new StorageRefused(`storage responded ${xhr.status}`));
      else reject(new Error(`storage responded ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('upload aborted')));
    xhr.send(file);
  });
}
