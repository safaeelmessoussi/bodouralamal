/**
 * **Whether a form's values differ from the ones it opened with.**
 *
 * `FormDialog` protects unsaved work and needs this to know when to; only the
 * form can answer it, because the dialog sees children rather than state. So each
 * form reports it, and this is how — one line per dialog instead of a bespoke
 * comparison in each.
 *
 * ## Why the caller passes BOTH sides
 *
 * The obvious design is a hook that remembers the values on open and compares
 * later renders against them. It does not work here, and the reason is worth
 * recording because it is easy to reintroduce: **these dialogs reset their fields
 * in an effect**, which runs *after* the first render. A baseline captured during
 * that render sees the *previous* record's values, the effect then writes the new
 * ones, and the form reports itself dirty the instant it opens — so an edit dialog
 * would ask *"discard your changes?"* to somebody who had changed nothing.
 *
 * Passing the pristine values explicitly removes the timing question entirely.
 * The form already knows them — they are the same expressions its reset effect
 * uses — and comparing against the record rather than against a captured moment
 * is also more correct: typing a change and then undoing it back to the original
 * is genuinely **not** dirty, and this reports that.
 *
 * A plain function rather than a hook, because there is no state to hold. That is
 * the whole reason it is trustworthy.
 *
 * ## The comparison
 *
 * `JSON.stringify` over a caller-built snapshot:
 *
 * * **order-sensitive for arrays**, which is right — a reordered list is a change;
 * * **order-INSENSITIVE for object keys** (2026-08-28). It was order-sensitive,
 *   on the reasoning that both snapshots are built by the same literal in the
 *   same file — and الجدولة falsified that: its two snapshots are **separate
 *   literals**, and `schedulingTypeId` was second in one and twentieth in the
 *   other. Every value matched and the form was permanently dirty, so opening
 *   إضافة عنصر or تعديل العنصر and closing it asked to discard nothing. A key
 *   position is not information about what the reader typed, so it no longer
 *   decides;
 * * no dependency and no deep-equal helper for a handful of scalars.
 *
 * Sets and Maps do not serialise; convert them to sorted arrays in the snapshot.
 */
export function isDirty(current: unknown, pristine: unknown): boolean {
  return stable(current ?? null) !== stable(pristine ?? null);
}

/**
 * `JSON.stringify` with **object keys sorted**, recursively.
 *
 * Arrays keep their order, deliberately: a reordered list *is* a change, which
 * is the one thing the original comparison got right and this must not lose.
 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const source = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = source[key];
    return sorted;
  });
}
