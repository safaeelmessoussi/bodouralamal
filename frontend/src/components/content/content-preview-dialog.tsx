import { useEffect, useState, type ReactNode } from 'react';

import { fetchContentUrl, type ContentItem } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';

/**
 * The one content viewer. Every preview and every download in the platform goes
 * through here, so the §14.6 behaviour table is implemented **once**:
 *
 * | Kind      | Behaviour                                    |
 * |-----------|----------------------------------------------|
 * | PDF       | Inline in an `<iframe>`, plus download       |
 * | Video     | Native `<video controls>`, plus download     |
 * | Audio     | Native `<audio controls>`, plus download     |
 * | Image     | Shown at full width, plus download           |
 * | Document  | **Download only** — no in-browser rendering  |
 *
 * **Native elements, not a player library.** A `<video>` gives keyboard control,
 * captions, picture-in-picture and the platform's own scrubber for free, and
 * §3.1's CSP admits no external script host anyway. The same call the branch
 * `<select>` and the native `<dialog>` got.
 *
 * **The URL is fetched when the dialog opens, not when the list is drawn.**
 * Private content is reachable only through a short-lived presigned GET minted
 * after a server-side permission check (§3.1, TD-12) — a ten-minute URL attached
 * to every card in a list would be expired before most of them were clicked, and
 * would mint permission checks for content nobody opened.
 *
 * **A long recording can outlive its URL**, which is a real consequence of that
 * TTL and not a bug in this component: a 40-minute video opened at minute nine
 * of its URL's life will stall. The retry action re-mints, which is the honest
 * answer until the Document Owner decides whether the client should refresh
 * pre-emptively.
 */
type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'unavailable' }
  | { kind: 'error' };

/** Kinds §14.6 renders in place. Everything else is download-only. */
const PREVIEWABLE: ReadonlySet<ContentItem['kind']> = new Set(['pdf', 'video', 'audio', 'image']);

export function ContentPreviewDialog({
  item,
  onClose,
}: {
  item: ContentItem | null;
  onClose: () => void;
}): ReactNode {
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!item) {
      setLoad({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void (async () => {
      try {
        const url = await fetchContentUrl(item.id);
        if (cancelled) return;
        // An absent URL is not an error — it is the honest state while the mint
        // endpoint is unbuilt, and it must not render as a broken player.
        setLoad(url ? { kind: 'ready', url } : { kind: 'unavailable' });
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item, attempt]);

  return (
    <Dialog open={item !== null} onClose={onClose} title={item?.title ?? t('content.previewTitle')} wide>
      {item ? (
        <div className="preview">
          {item.description ? <p className="preview__description">{item.description}</p> : null}

          <div className="preview__stage">
            {load.kind === 'loading' ? (
              <div className="preview__placeholder" role="status" aria-live="polite">
                <span className="skeleton skeleton--wide" />
                <span className="visually-hidden">{t('states.loading')}</span>
              </div>
            ) : null}

            {load.kind === 'error' ? (
              <p className="preview__placeholder" role="alert">
                {t('content.previewError')}
              </p>
            ) : null}

            {/* Deliberately distinct from an error: nothing is wrong, the file
                simply cannot be served yet. */}
            {load.kind === 'unavailable' ? (
              <p className="preview__placeholder">{t('content.previewUnavailable')}</p>
            ) : null}

            {load.kind === 'ready' ? <PreviewSurface item={item} url={load.url} /> : null}

            {/* Office files never render in place (§14.6), so the stage states
                what will happen instead of showing an empty frame. */}
            {!PREVIEWABLE.has(item.kind) && load.kind !== 'loading' ? (
              <p className="preview__placeholder">{t('content.previewDownloadOnly')}</p>
            ) : null}
          </div>

          <div className="preview__actions">
            {load.kind === 'ready' ? (
              // A new tab rather than an anchor with `download`: the object is
              // served with its own Content-Disposition, and `noopener` keeps the
              // opened context from reaching back into this one.
              <Button
                variant="primary"
                icon="download"
                onClick={() => window.open(load.url, '_blank', 'noopener,noreferrer')}
              >
                {t('content.download')}
              </Button>
            ) : null}
            {load.kind === 'error' || load.kind === 'unavailable' ? (
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                {t('states.offlineRetry')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * The element for one kind. Split out so the switch is exhaustive and readable,
 * and so adding a kind is one branch here rather than a change to the dialog's
 * state machine.
 */
function PreviewSurface({ item, url }: { item: ContentItem; url: string }): ReactNode {
  switch (item.kind) {
    case 'pdf':
      // `title` is the accessible name of the frame; without it a screen reader
      // announces an unnamed embedded document.
      return <iframe className="preview__pdf" src={url} title={item.title} />;
    case 'video':
      return (
        <video className="preview__video" controls preload="metadata">
          <source src={url} type={item.mime_type} />
          {t('content.previewUnsupported')}
        </video>
      );
    case 'audio':
      return (
        <audio className="preview__audio" controls preload="metadata">
          <source src={url} type={item.mime_type} />
          {t('content.previewUnsupported')}
        </audio>
      );
    case 'image':
      // The title is the alt text: these are teaching materials, so the name is
      // the best description available without an author-supplied one.
      return <img className="preview__image" src={url} alt={item.title} />;
    case 'document':
      return null;
  }
}
