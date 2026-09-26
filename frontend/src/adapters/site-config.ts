import { api } from '../lib/api.js';

/**
 * What the public chrome may offer on THIS deployment (R175 §2).
 *
 * About the deployment, never about the caller: anonymous, no cookie, no
 * personal data — which is what lets the temporary Production tier promise a
 * reader that nothing about them is stored.
 */
export interface SiteConfig {
  /** Whether the shared «تسجيل الدخول» control renders. */
  sign_in_offered: boolean;
}

/**
 * **A failure means «not answered», and nothing is offered on an unanswered
 * question** (2026-09-26, found on the live site).
 *
 * The first shape of this fallback said a failure means OFFERED, so that a
 * hiccup could not hide the way in. That was wrong twice over: on the public
 * tier the control flashed onto the page for the seconds an API restart takes
 * — which is exactly the invitation the tier exists not to extend — and when
 * the API is unreachable **sign-in cannot work anyway**, so a button that
 * leads nowhere is worse than no button.
 *
 * The Owner's own way in never depends on this call: `/login` keeps its
 * control and `/api/v1/auth/google` is a plain link.
 */
export async function fetchSiteConfig(): Promise<SiteConfig | null> {
  try {
    return (await api<{ data: SiteConfig }>('/site-config')).data;
  } catch {
    return null;
  }
}
