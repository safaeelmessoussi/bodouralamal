import { useEffect, useState, type ReactNode } from 'react';

import { fetchSessionPage, type SessionContentRef, type SessionPage } from '../adapters/calendar.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { ButtonLink } from '../components/ui/button.js';
import { t } from '../i18n/index.js';
import { formatDate } from '../lib/format-date.js';
import { ApiError } from '../lib/api.js';

/**
 * `/calendar/sessions/{id}` — the §5.2 Session page (TD-3.4).
 *
 * **Public, at the caller's tier.** An anonymous visitor sees a public session's
 * existence and details and **never its private recordings** — the server
 * decides that, and this page renders whatever it is given. There is no
 * client-side filtering here and there must not be: a client that filters is a
 * second implementation of a permission rule.
 *
 * **A cancelled session is shown, not hidden.** The calendar's job is to say a
 * class is not happening; hiding it would leave a reader assuming it still is.
 * The status is announced rather than merely coloured — §14.4's rule that colour
 * never carries meaning alone.
 *
 * **Recordings and materials are separate lists** because the API separates
 * them: a recording is an §4.9 recording resource, which is what BR-2's consent
 * gate acts on. Merging them here would discard exactly the distinction that
 * makes the gate legible.
 *
 * **`notes` is rendered only when present.** It is always `null` today — TD-3.4
 * names it, §7 defines no storage, and the Document Owner has not taken that
 * schema decision — so the page must not draw an empty "Notes" heading that
 * implies someone forgot to write any.
 */
export function SessionPage(): ReactNode {
  const id = window.location.pathname.split('/').pop() ?? '';
  const [page, setPage] = useState<SessionPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    void (async () => {
      try {
        setPage(await fetchSessionPage(id));
        setState('ready');
      } catch (error) {
        // A 404 is a different fact from a failure, and §14.4 gives them
        // different pages: one says the class does not exist, the other says we
        // could not find out.
        setState(error instanceof ApiError && error.status === 404 ? 'missing' : 'error');
      }
    })();
  }, [id]);

  return (
    <>
      <ApplicationHeader />
      <main id="main" className="container">
        {state === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
        {state === 'missing' ? (
          <div className="state" role="status">
            <p>{t('session.notFound')}</p>
            <ButtonLink variant="secondary" href="/calendar">
              {t('session.backToCalendar')}
            </ButtonLink>
          </div>
        ) : null}
        {state === 'error' ? (
          <p className="state" role="alert">
            {t('common.loadFailed')}
          </p>
        ) : null}

        {state === 'ready' && page ? <SessionBody page={page} /> : null}
      </main>
      <SiteFooter />
    </>
  );
}

function SessionBody({ page }: { page: SessionPage }): ReactNode {
  const o = page.occurrence;
  const cancelled = o.status === 'cancelled';

  return (
    <article>
      <h1>{o.title}</h1>

      {cancelled ? (
        // Announced, not merely styled: colour never carries meaning alone
        // (§14.4), and this is the one fact a reader most needs.
        <p role="status" className="badge badge--danger">
          {t('session.cancelled')}
        </p>
      ) : null}

      <dl>
        <dt>{t('session.date')}</dt>
        <dd>
          <time dateTime={o.date}>{formatDate(o.date)}</time>
          {/* The official Hijri overlay, only when the Ministry's month has been
              recorded and published — never computed here (§20 rule 14). */}
          {o.hijri_date ? <span className="muted"> — {o.hijri_date}</span> : null}
        </dd>

        {o.start_time ? (
          <>
            <dt>{t('session.time')}</dt>
            {/* Wall-clock, rendered exactly as sent (TD-11). Parsing these would
                move the class for a reader in another timezone. */}
            <dd>
              {o.start_time}
              {o.end_time ? ` – ${o.end_time}` : null}
            </dd>
          </>
        ) : null}

        {o.audience_label ? (
          <>
            <dt>{t('session.audience')}</dt>
            <dd>{o.audience_label}</dd>
          </>
        ) : null}

        {o.level_name ? (
          <>
            <dt>{t('session.level')}</dt>
            <dd>{o.level_name}</dd>
          </>
        ) : null}

        {o.branch_name ? (
          <>
            <dt>{t('session.branch')}</dt>
            <dd>{o.branch_name}</dd>
          </>
        ) : null}

        {o.room_name ? (
          <>
            <dt>{t('session.room')}</dt>
            <dd>{o.room_name}</dd>
          </>
        ) : null}

        {o.instructors.length > 0 ? (
          <>
            <dt>{t('session.staff')}</dt>
            {/* `display_name` is ALREADY RESOLVED by the backend (§7, §20 rule
                21). Rendered verbatim — this page implements no fallback, because
                a fallback is a second answer to which name a person published. */}
            <dd>{o.instructors.map((i) => i.display_name).join('، ')}</dd>
          </>
        ) : null}
      </dl>

      {page.notes ? (
        <section>
          <h2>{t('session.notes')}</h2>
          <p>{page.notes}</p>
        </section>
      ) : null}

      <ContentList title={t('session.recordings')} items={page.recordings} />
      <ContentList title={t('session.materials')} items={page.linked_content} />
    </article>
  );
}

/**
 * A list of attached items.
 *
 * Renders nothing at all when empty rather than an empty heading: on a **public**
 * page an empty "Recordings" section reads as *there are none*, when the honest
 * reading for an anonymous visitor may be *there are some you may not see*. A
 * heading that cannot tell those apart is better absent.
 *
 * Each item links **into the Educational Library** (§5.2) — one reader, one
 * permission path — rather than to a download, which only
 * `GET /content/{id}/download-url` may mint after its own check.
 */
function ContentList({ title, items }: { title: string; items: SessionContentRef[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {/* **The deep link the library actually honours** (fixed 2026-08-17).
                This read `?content_id=`, which nothing anywhere consumed: the
                library routes on `?level=`, so the link landed on the Category
                index and the item a reader had just clicked was not opened, not
                highlighted, and not even on the page.

                `level_id` travels on the ref already, so the link can name both
                halves — which Level's shelf to open, and which item on it. The
                library reads `?content=` and opens its preview. */}
            <a href={`/resources?level=${item.level_id}&content=${item.id}`}>{item.title}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
