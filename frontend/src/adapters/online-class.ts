import { api } from '../lib/api.js';

/**
 * **R98 — the one request that opens a classroom.**
 *
 * The client sends **the Session id and an empty body**. It does not name the
 * participant, the room, the role or the grants, and the endpoint is
 * `.strict()`, so it could not — every one of those is resolved on the server
 * from the authenticated caller, the R92 audience and the R91 assignment.
 *
 * The active child travels where it always does (`X-Active-Child-ID`, §4.3),
 * because a guardian opening her daughter's class is the same mechanism as a
 * guardian opening her daughter's library. It is a **claim the server verifies**
 * against an approved `FamilyLink` on this very request, never an authorization
 * the client holds.
 *
 * **This is the only place in the client that knows a join exists**, and it
 * knows nothing about which media platform answers: `url` and `token` are the
 * whole vocabulary.
 */
export interface JoinCredentials {
  session_id: string;
  /** The media server's signalling URL. Opaque here — handed straight to the
   *  classroom component and never parsed. */
  url: string;
  /** A short-lived participant token. Never persisted: it is requested when a
   *  classroom opens and discarded when it closes. */
  token: string;
  expires_at: string;
  media_mode: 'audio_video' | 'audio_only';
  role: 'teacher' | 'assistant' | 'student' | 'admin';
  display_name: string;
  closes_at: string;
}

export async function requestJoin(
  sessionId: string,
  token: string,
  activeChildId: string | null,
): Promise<JoinCredentials> {
  const response = await api<{ data: JoinCredentials }>(
    `/sessions/${sessionId}/online-join`,
    { method: 'POST', token, activeChildId, body: {} },
  );
  return response.data;
}

/**
 * **R99 — the recording of a class, which is OPTIONAL.**
 *
 * `null` from `readRecordingState` is the ordinary answer and a real one: a
 * class nobody recorded has no state, and the classroom shows no recording
 * banner at all rather than «لم يبدأ التسجيل» on every screen.
 *
 * Starting and stopping carry an **empty body** for the same reason joining
 * does — in particular there is no `media_mode`, because the format follows the
 * class (R99.7) and a client that could name it could record video of a صوت فقط
 * lesson.
 */
export interface RecordingState {
  id: string;
  status:
    | 'starting'
    | 'recording'
    | 'stopping'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'aborted';
  started_at: string;
  stopped_at: string | null;
  /** Resolved server-side so two screens cannot disagree about «جاري التسجيل». */
  live: boolean;
  /**
   * **Where the recording is from the ASSOCIATION's point of view** (R99.14),
   * which is not what `status` above answers.
   *
   * `status` is the PROVIDER's: `completed` means an object exists in a staging
   * bucket. This is the platform's, derived server-side from the library item
   * existing, and it is what «متاح» may be said on. A client that had only the
   * provider's word would have to invent the distinction R99.14 requires it to
   * make — and would get it wrong in the direction that sends a مؤطِّرة looking
   * for a recording that is not there.
   */
  availability:
    | 'capturing'
    | 'processing'
    | 'importing'
    | 'available'
    | 'import_failed'
    | 'failed';
  /** The library item, once there is one. **There is deliberately no provider
   *  URL on this type** — provider output is never the content asset (R99.13). */
  educational_content_id: string | null;
}

export async function readRecordingState(
  sessionId: string,
  token: string,
  activeChildId: string | null,
): Promise<RecordingState | null> {
  const response = await api<{ data: RecordingState | null }>(
    `/sessions/${sessionId}/recording`,
    { token, activeChildId },
  );
  return response.data;
}

export async function startRecording(
  sessionId: string,
  token: string,
): Promise<RecordingState> {
  const response = await api<{ data: RecordingState }>(
    `/sessions/${sessionId}/recording`,
    { method: 'POST', token, body: {} },
  );
  return response.data;
}

export async function stopRecording(
  sessionId: string,
  token: string,
): Promise<RecordingState> {
  const response = await api<{ data: RecordingState }>(
    `/sessions/${sessionId}/recording/stop`,
    { method: 'POST', token, body: {} },
  );
  return response.data;
}
