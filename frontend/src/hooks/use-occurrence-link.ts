import { useCallback, useEffect, useState } from 'react';
import { fetchOccurrences, type Occurrence } from '../adapters/calendar.js';
import { readOccurrenceAddress } from '../lib/occurrence-link.js';

/** URL state belongs to the calendar, never to a global store. A link reads one
 * authorized day independently of presentation filters and profile prefill. */
export function useOccurrenceLink(
  accessToken: string | null,
  sessionStatus: 'loading' | 'anonymous' | 'authenticated',
) {
  const [search, setSearch] = useState(() => window.location.search);
  const [attempt, setAttempt] = useState(0);
  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [status, setStatus] = useState<'closed' | 'loading' | 'ready' | 'unavailable' | 'error'>('closed');

  useEffect(() => {
    const read = (): void => setSearch(window.location.search);
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  useEffect(() => {
    let live = true;
    const address = readOccurrenceAddress(search);
    setOccurrence(null);
    if (!new URLSearchParams(search).has('occurrence')) {
      setStatus('closed');
      return;
    }
    if (!address) {
      setStatus('unavailable');
      return;
    }
    // A private occurrence must not flash "unavailable" while the ordinary
    // refresh-cookie exchange is still establishing the caller's tier.
    if (sessionStatus === 'loading') {
      setStatus('loading');
      return;
    }
    setStatus('loading');
    void fetchOccurrences({ from: address.date, to: address.date, token: accessToken })
      .then(({ occurrences }) => {
        if (!live) return;
        const found = occurrences.find(
          (o) => o.kind === address.kind && o.id === address.id && o.date === address.date,
        );
        setOccurrence(found ?? null);
        setStatus(found ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (live) setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [search, accessToken, sessionStatus, attempt]);

  const close = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('occurrence');
    url.searchParams.delete('date');
    window.history.replaceState(null, '', url);
    setSearch(url.search);
    setOccurrence(null);
    setStatus('closed');
  }, []);

  return { occurrence, status, close, retry: () => setAttempt((n) => n + 1) };
}
