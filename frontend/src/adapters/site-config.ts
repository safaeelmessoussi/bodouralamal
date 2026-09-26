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
 * **A failure means «offered»** — the platform's own behaviour. A hiccup on
 * this one call must never be able to hide the way in from everybody.
 */
export async function fetchSiteConfig(): Promise<SiteConfig> {
  try {
    return (await api<{ data: SiteConfig }>('/site-config')).data;
  } catch {
    return { sign_in_offered: true };
  }
}
