/**
 * Where a signed-in person lands after authenticating (§4.1b step 4a, §14.1).
 *
 * §4.1b calls the post-login landing a **"role-based dashboard redirect"**, and
 * §14.1's sitemap names the destinations: `/dashboard/student`, `/teacher`,
 * `/admin`. **There is no Parent Dashboard and no bare `/dashboard`
 * node** — and the callback nevertheless redirected every active account there,
 * so a Super Admin signing in landed on a page that does not exist.
 *
 * **The server decides, because only the server knows the roles at this moment**
 * (§1.1). The redirect must name a real URL; sending the browser somewhere
 * neutral to be re-routed would put an extra page between signing in and
 * arriving, which is the thing being fixed.
 *
 * The client mirrors this list in `frontend/src/lib/role-home.ts` for the header
 * button. **Both derive from §14.1, which is the single authority** — neither
 * copies the other, and a change to the sitemap updates both or is a defect.
 */

/** Most-privileged first: a person may hold several roles and this is one URL. */
const ROLE_HOMES: { role: string; path: string }[] = [
  { role: 'super_admin', path: '/admin' },
  { role: 'admin', path: '/admin' },
  { role: 'teacher', path: '/teacher' },
  { role: 'parent', path: '/dashboard/student' },
  { role: 'student', path: '/dashboard/student' },
];

/**
 * The landing page for these roles.
 *
 * **Never returns a path the client does not serve.** An account holding no
 * role that has a home lands on `/` — §14.4's no-role case is reachable only
 * through staff error, and the landing page is a real page that offers a way
 * onward, which a 404 is not.
 */
export function postLoginDestination(roles: readonly string[]): string {
  for (const { role, path } of ROLE_HOMES) {
    if (roles.includes(role)) return path;
  }
  return '/';
}
