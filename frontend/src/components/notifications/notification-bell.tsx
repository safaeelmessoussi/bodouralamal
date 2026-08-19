import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { listNotifications } from '../../adapters/notifications.js';
import { t } from '../../i18n/index.js';
import { Icon } from '../ui/icon.js';
import { NotificationList } from './notification-list.js';

/**
 * **The bell — one notification control, on every authenticated screen** (§4.8).
 *
 * The list existed and was mounted on **one** page, so a مؤطرة marking grades or
 * a beneficiary reading her library had no way to learn a class had moved
 * without navigating home first. A notice nobody encounters is a notice that was
 * not delivered.
 *
 * **One component, not one per role.** It renders the same `NotificationList`
 * the dashboards did — the panel is a container, not a second implementation —
 * and the list's own rules are untouched: nothing is marked read by being
 * rendered (R77.5 turns on that distinction), and a read notice still shows,
 * because a read notice is still true.
 *
 * **The count is the unread count the server already returns.** It is not
 * derived here from the fetched page: a client that counted its own rows would
 * disagree with the server the moment the list is paginated, and the badge is
 * the thing people trust.
 */
export function NotificationBell({ token }: { token: string | null }): ReactNode {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      // `page_size=1` — the badge needs the META, not the rows. Fetching a full
      // page to render a number would make every screen pay for a list nobody
      // has opened.
      const body = await listNotifications(token, { pageSize: 1 });
      setUnread(body.meta.unread);
    } catch {
      // A failed count is not worth an error state in the chrome: the bell
      // simply shows none, and opening the panel reports the real failure.
      setUnread(0);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escape and an outside click close it — the same expectations any menu in
  // the header already meets.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent): void => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="bell" ref={panel}>
      <button
        type="button"
        className="bell__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        // The count belongs in the accessible name, not only in a badge a
        // screen reader would read as a bare number beside an icon.
        aria-label={
          unread > 0
            ? t('notifications.bellWithCount').replace('{n}', String(unread))
            : t('notifications.bell')
        }
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
      >
        <Icon name="bell" size={20} />
        {unread > 0 ? (
          <span className="bell__count" aria-hidden="true">
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="bell__panel" role="dialog" aria-label={t('notifications.title')}>
          {/* The SAME list the dashboards rendered. `alwaysRender` keeps the
              panel from being an empty box that says nothing when opened —
              on a dashboard, rendering nothing was right; here it is not. */}
          <NotificationList token={token} alwaysRender onChange={() => void refresh()} />
        </div>
      ) : null}
    </div>
  );
}
