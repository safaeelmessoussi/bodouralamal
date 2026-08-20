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
