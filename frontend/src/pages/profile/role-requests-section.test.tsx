import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RoleRequestsSection } from './index.js';
import { t } from '../../i18n/index.js';

/**
 * **«صفاتي وطلباتي» is always on «حسابي»** (SRS Revision 170 §1).
 *
 * The Owner, 2026-09-21: «I don't find this». Her account holds every role and
 * was never registered through the form — nothing askable, no request — and the
 * section rendered NOTHING in exactly that case. A failed read removed it too.
 */
const render = (mine: Parameters<typeof RoleRequestsSection>[0]['mine']): string =>
  renderToStaticMarkup(<RoleRequestsSection mine={mine} onRetry={() => {}} />);

describe('the section never disappears', () => {
  it('a person who holds every role sees the section, her roles, and WHY there is no button', () => {
    const html = render({ requests: [], askable: [], held: ['student', 'teaching', 'administration'] });
    expect(html).toContain(t('profile.requestRole.sectionTitle'));
    expect(html).toContain('data-role-held="administration"');
    expect(html).toContain(t('profile.requestRole.nothingToAsk'));
    expect(html).not.toContain('/profile/request-role');
  });

  it('a role that can be asked for brings the button, and no «nothing to ask» sentence', () => {
    const html = render({ requests: [], askable: ['teaching'], held: ['student'] });
    expect(html).toContain('href="/profile/request-role"');
    expect(html).toContain(t('profile.requestRole.title'));
    expect(html).not.toContain(t('profile.requestRole.nothingToAsk'));
  });

  it('lists what she asked for with its state, under its own heading', () => {
    const html = render({
      requests: [{ kind: 'teaching', status: 'declined', decided_at: '2026-09-21T10:00:00.000Z' }],
      askable: ['teaching'],
      held: [],
    });
    expect(html).toContain(t('profile.requestRole.requestsTitle'));
    expect(html).toContain('data-role-status="declined"');
    expect(html).toContain(t('profile.requestRole.heldNone'));
  });

  it('a failed read is SAID, in the one appearance every failure has — the heading stays', () => {
    const html = render(null);
    expect(html).toContain(t('profile.requestRole.sectionTitle'));
    expect(html).toContain('class="error-panel');
    expect(html).not.toContain('data-roles-held');
  });
});
