import { useState, type ReactNode } from 'react';

import type { ScopeValue } from '../../hooks/use-scope-options.js';
import { AuthorPicker, authorMeta, NO_AUTHOR, type AuthorValue } from './author-picker.js';
import { FileUploader } from './file-uploader.js';
import { GLOBAL, useContentScope } from './content-scope-fields.js';

export { GLOBAL };

/**
 * **The Content Upload form, self-contained** (Owner UX rule, 2026-08-25 — rule AX).
 *
 * ## The rule this exists to satisfy
 *
 * > **Every field that materially determines the object being created or edited
 * > must be visible inside that create/edit form.** The form may pre-fill those
 * > fields from the current page filters, but they must still be visible so the
 * > person can understand exactly what will be saved.
 *
 * ## What was wrong
 *
 * The dialog carried a file, a title, a description and a visibility — and then
 * said *«… المستوى والمادة والسنة الدراسية قبل الرفع»* while containing
 * none of those three controls. They lived in the page's **filter** bar, so the
 * form's own instruction pointed at something outside itself, and the upload
 * target was invisible at the moment of saving. A person could not answer *what
 * am I about to create* by reading the form.
 *
 * ## How it is fixed, and why it is not a new mechanism
 *
 * The platform already distinguishes **filter** selectors from **form** ones
 * (rule AE); since R198 §3 every selector narrows the others, so a pair the
 * server refuses cannot be offered, and a required field is marked * rather
 * than explained in a sentence. This form therefore runs its **own**
 * `useScopeOptions` in form mode, seeded once from the page's filters, and
 * every subsequent change belongs to the form. Nothing here reads page state
 * after mount — which is the actual content of *"do not silently depend on page
 * filters once the form is open"*.
 *
 * ## Authorization is unchanged, and stays the server's
 *
 * Since R198 §2 the branches are a multi-select and choosing none is Global
 * (§4.9) — there is no «بدون فرع» value to offer or withhold. A مؤطِّرة must
 * name at least one (marked *): Global is not hers to assign. The server
 * decides regardless (rule O).
 */
export interface ContentUploadFormProps {
  token: string | null;
  /** Whether this caller may assign the Global scope (§4.9). Passed in rather
   *  than derived here: a component never decides authorization (rule O). */
  mayAssignGlobal: boolean;
  /** Seed values, normally the page's current filters. Read **once**, at mount. */
  initial: Partial<ScopeValue>;
  /**
   * Replacement (R53) keeps the record and swaps only the object, so its scope
   * and visibility are the row's and are **not editable here**. They are still
   * rendered — disabled rather than hidden — because the rule is about a person
   * being able to see what will be saved, and *"this is fixed"* is exactly the
   * thing a hidden field fails to say.
   */
  replacing?: {
    id: string;
    title: string;
    description: string;
    visibility: string;
  };
  submitLabel: string;
  onUploaded: (contentIds: string[]) => void;
  onCancel: () => void;
}

export function ContentUploadForm({
  token,
  mayAssignGlobal,
  initial,
  replacing,
  submitLabel,
  onUploaded,
  onCancel,
}: ContentUploadFormProps): ReactNode {
  const locked = replacing !== undefined;

  // The scope block is shared with the recorder (§10): same object, same
  // four-part scope, same visibility rule — so one implementation.
  const { fields, meta, problem, suggestedTitle, complete } = useContentScope({
    token,
    mayAssignGlobal,
    initial,
    locked,
    ...(replacing ? { lockedVisibility: replacing.visibility } : {}),
  });

  // R215 — who made it; the directory it searches is the administration's.
  const [author, setAuthor] = useState<AuthorValue>(NO_AUTHOR);
  const pickAuthor = mayAssignGlobal && !locked;
  const uploadMeta = {
    ...meta,
    ...(replacing ? { replaces_content_id: replacing.id } : {}),
    ...(pickAuthor ? authorMeta(author) : {}),
  };

  return (
    <>
      {fields}
      {pickAuthor ? <AuthorPicker value={author} onChange={setAuthor} token={token} /> : null}

      <FileUploader
        meta={uploadMeta}
        token={token}
        {...(replacing
          ? { initialTitle: replacing.title, initialDescription: replacing.description }
          : { suggestedTitle })}
        submitLabel={submitLabel}
        disabledReason={locked ? null : problem}
        incomplete={!locked && !complete}
        single={locked}
        onCancel={onCancel}
        onUploaded={onUploaded}
      />
    </>
  );
}
