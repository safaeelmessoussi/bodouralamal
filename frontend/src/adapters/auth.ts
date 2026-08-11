import { api } from '../lib/api.js';

/**
 * `POST /auth/switch-role` (R60.3) — work as another of your own roles.
 *
 * Returns the token the server minted, already narrowed. The caller stores the
 * granted role and navigates; the next page re-acquires an equivalent token from
 * `/auth/refresh`, which is what makes the choice persist.
 */
export async function switchRole(
  role: string,
  token: string | null,
): Promise<{ access_token: string; active_role: string }> {
  return api<{ access_token: string; active_role: string }>('/auth/switch-role', {
    method: 'POST',
    token,
    body: { role },
  });
}
