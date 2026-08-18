import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * **The one place a message about an action appears** (2026-08-18).
 *
 * Four kinds of message exist on this platform and they are NOT interchangeable
 * — each answers a different question and therefore belongs somewhere different:
 *
 * | kind | question | where it belongs |
 * |------|----------|------------------|
 * | **action** | *did the thing I just clicked work* | beside the controls that did it — this component |
 * | **field** | *what is wrong with THIS value* | under the input — `Field`'s `error` |
 * | **page** | *why is there nothing here* | in place of the content — `ErrorState` |
 * | **form** | *why will this form not submit* | above the form's own buttons — `FormDialog`'s `notice` |
 *
 * Before this component the first kind was hand-written 28 times across 22
 * files, every copy a `<p className="admin-notice" role="status" aria-live=
 * "polite">` — which is rule C: one concept, one atomic component. They had
 * already drifted: some carried `aria-live`, some did not, so on those screens a
 * screen-reader user was never told the action had succeeded at all.
 *
 * **Being in the right place is not enough — it has to be SEEN.** A refusal
 * rendered above a long table while the reader is at the bottom of it is a
 * refusal nobody reads, and the click simply looks ignored. So the component
 * brings itself into view when its message changes, by the smallest scroll that
 * makes it visible (`block: 'nearest'`), and never when it is visible already.
 */
export function Feedback({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  /**
   * `info` for the ordinary outcome, `warn` for a standing caution the reader
   * has not just caused. Refusals use `info` too: the message says what was
   * refused, and a second colour for "the server said no" would make routine
   * validation look like a system failure.
   */
  tone?: 'info' | 'warn';
}): ReactNode {
  const box = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // `nearest` scrolls the least that works, and does nothing when the element
    // is already on screen — which is what keeps a success message from yanking
    // the page on every save.
    box.current?.scrollIntoView({ block: 'nearest' });
  }, [children]);

  return (
    <p
      ref={box}
      className={tone === 'warn' ? 'admin-notice admin-notice--warn' : 'admin-notice'}
      // A standing caution is part of the page; an outcome is an announcement.
      // Announcing a caution on every render would repeat it endlessly.
      {...(tone === 'warn' ? {} : { role: 'status' as const, 'aria-live': 'polite' as const })}
    >
      {children}
    </p>
  );
}

/**
 * The state behind an action message: the value, its setter, and the node.
 *
 * Screens kept `const [notice, setNotice] = useState<string | null>(null)` and
 * then each rendered it themselves — which is how the markup drifted. Here the
 * rendering is not the caller's to write.
 */
export function useActionFeedback(): {
  notice: string | null;
  setNotice: (message: string | null) => void;
  feedback: ReactNode;
} {
  const [notice, set] = useState<string | null>(null);
  const setNotice = useCallback((message: string | null) => set(message), []);
  return {
    notice,
    setNotice,
    feedback: notice === null ? null : <Feedback>{notice}</Feedback>,
  };
}
