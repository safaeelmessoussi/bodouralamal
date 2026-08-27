import type { ReactNode } from 'react';

import type { ScopeValue } from '../../hooks/use-scope-options.js';
import { AudioRecorder } from './audio-recorder.js';
import { useContentScope } from './content-scope-fields.js';

/**
 * **The Content Recorder, self-contained** (§10 — rule AX's last confirmed
 * instance, closed 2026-08-27).
 *
 * ## What it was
 *
 * The recorder on مكتبة المحتوى took its scope from the **page's filter bar**
 * and refused to open at all until those filters happened to be set:
 *
 * ```tsx
 * {recorderScopeProblem !== null ? <p>choose a scope first</p> : <AudioRecorder meta={…} />}
 * ```
 *
 * That broke two rules at once. **AX**, because the four fields that decide what
 * the recording *is* were not in the form that creates it — they were behind the
 * dialog, on the page, and a person recording could not see what they were about
 * to file it under. And **A/F**, because a filter was acting as a
 * **precondition**: filters narrow what is visible, they are never the gate that
 * makes an action available.
 *
 * ## Why it was left for its own slice
 *
 * The 2026-08-25 audit fixed the upload dialog and deliberately stopped there:
 * R75's recorder has a **separate submit path** — a `MediaRecorder`, a blob and
 * a permission prompt rather than a file input — and converting both at once
 * would have made one browser regression answer for two behaviours.
 *
 * ## What makes this not a second implementation
 *
 * The scope block is `useContentScope`, shared with `ContentUploadForm`. Both
 * surfaces create the same object under the same four-part scope and the same
 * §14.1 visibility rule; only what produces the bytes differs. A copied scope
 * block would have drifted, and on this project the copy that drifts still
 * passes its own tests.
 *
 * The recorder is **not** gated on the scope being complete. It renders and can
 * record; `AudioRecorder` refuses to *save* without a Level, Subject and year,
 * which is the honest place for that refusal — somebody may reasonably start
 * recording and decide where it belongs afterwards, and losing captured audio to
 * a filter that was not set would be the worse failure.
 */
export function ContentRecorderForm({
  token,
  mayAssignGlobal,
  initial,
  suggestedName,
  onSaved,
  onCancel,
}: {
  token: string | null;
  /** Whether this caller may assign the Global scope (§4.9). Passed in rather
   *  than derived here: a component never decides authorization (rule O). */
  mayAssignGlobal: boolean;
  /** Seed values, normally the page's current filters. Read **once**, at mount. */
  initial: Partial<ScopeValue>;
  suggestedName: string;
  onSaved: () => void;
  onCancel: () => void;
}): ReactNode {
  const { fields, meta, problem } = useContentScope({ token, mayAssignGlobal, initial });

  return (
    <>
      {fields}

      <AudioRecorder
        meta={meta}
        token={token}
        suggestedName={suggestedName}
        saveBlockedReason={problem}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    </>
  );
}
