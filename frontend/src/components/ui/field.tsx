import { useId, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';

/**
 * Form field primitives — **the platform's form infrastructure**, not this
 * screen's inputs (constitution §0.1).
 *
 * §14.3's registry lists selectors and a file uploader but **no form primitives
 * at all**, which was a real gap: a hand-rolled `<input>` is one missing `for`
 * attribute away from an unlabelled control, and nobody notices until someone
 * using a screen reader does.
 *
 * Every field here owns the four things a hand-rolled input forgets:
 *
 * 1. **Label association** by generated id — `useId`, so two instances on one
 *    page cannot collide (the bug the shared `Dialog` shipped with).
 * 2. **Error rendering**, wired with `aria-describedby` and `aria-invalid`, so
 *    the message is announced rather than merely displayed.
 * 3. **Required marking**, visible *and* programmatic.
 * 4. **Hint text**, also in `aria-describedby` — a limit a reader learns only by
 *    tripping over it is a limit stated too late.
 *
 * Each field **picks a value and nothing else** (§3.2): it does not validate, it
 * does not format, it does not call an API. The form composes that.
 */

interface FieldShellProps {
  label: string;
  error?: string | null;
  hint?: string | null;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

/**
 * The label/hint/error scaffolding every field shares. Split out so a new field
 * type is one component and not a fourth copy of the accessibility wiring.
 */
function FieldShell({ label, error, hint, required, children }: FieldShellProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={error ? 'field field--invalid' : 'field'}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({ id, describedBy: describedBy || undefined })}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {/* `role="alert"` so a validation failure is announced when it appears,
          not only when the field is next focused. */}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface BaseProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string | null;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function TextField({
  type = 'text',
  ...props
}: BaseProps & { type?: 'text' | 'email' | 'tel' | 'url' }): ReactNode {
  return (
    <FieldShell {...props}>
      {({ id, describedBy }) => (
        <input
          id={id}
          className="field__control"
          type={type}
          value={props.value}
          required={props.required ?? false}
          disabled={props.disabled ?? false}
          placeholder={props.placeholder ?? ''}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

/** Multiline free text. Used for anything **displayed verbatim and never
 *  parsed** — opening hours being the platform's example (§7). */
export function TextArea({ rows = 4, ...props }: BaseProps & { rows?: number }): ReactNode {
  return (
    <FieldShell {...props}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          className="field__control field__control--area"
          rows={rows}
          value={props.value}
          required={props.required ?? false}
          disabled={props.disabled ?? false}
          placeholder={props.placeholder ?? ''}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

/** A local calendar date, `YYYY-MM-DD` — never an instant (TD-11). */
export function DateField(props: BaseProps): ReactNode {
  return (
    <FieldShell {...props}>
      {({ id, describedBy }) => (
        <input
          id={id}
          className="field__control"
          type="date"
          value={props.value}
          required={props.required ?? false}
          disabled={props.disabled ?? false}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function NumberField({
  min,
  max,
  ...props
}: BaseProps & { min?: number; max?: number }): ReactNode {
  return (
    <FieldShell {...props}>
      {({ id, describedBy }) => (
        <input
          id={id}
          className="field__control"
          type="number"
          value={props.value}
          min={min}
          max={max}
          required={props.required ?? false}
          disabled={props.disabled ?? false}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  options,
  busy = false,
  ...props
}: BaseProps & {
  options: { value: string; label: string }[];
  /**
   * The options are still loading — as when the calendar's Level list is being
   * re-fetched for a newly chosen Category. Marked `aria-busy` and disabled
   * rather than hidden, so the row does not reflow and the wait is announced
   * instead of merely visible.
   */
  busy?: boolean;
}): ReactNode {
  return (
    <FieldShell {...props}>
      {({ id, describedBy }) => (
        <select
          id={id}
          className="field__control"
          value={props.value}
          required={props.required ?? false}
          disabled={busy || (props.disabled ?? false)}
          aria-busy={busy || undefined}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => props.onChange(e.target.value)}
        >
          {props.placeholder !== undefined ? <option value="">{props.placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/**
 * Search. One component, so every list in the platform searches the same way —
 * `type="search"` gives the platform's own clear affordance for free.
 */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}): ReactNode {
  const id = useId();
  return (
    <div className="field field--search">
      <label className="field__label" htmlFor={id}>
        {label ?? t('common.search')}
      </label>
      <input
        id={id}
        type="search"
        className="field__control"
        value={value}
        placeholder={placeholder ?? t('common.searchPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
