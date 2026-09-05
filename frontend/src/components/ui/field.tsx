import { useId, type ReactNode } from 'react';

import { DatePicker } from './date-picker.js';
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

/**
 * **One tickable choice, checkbox or radio** — the choice control as an atomic
 * field (rule C), so a screen that needs one stops hand-writing `<label
 * className="field field--choice"><input>`. That markup existed in three places
 * before `CheckboxField`, and **four more copies had appeared since**, which is
 * why the shape is now owned here for radios too rather than only for booleans;
 * the class it uses is the platform's own and is unchanged.
 *
 * The label WRAPS the control rather than pointing at it with `htmlFor`, which
 * is why this does not reuse `FieldShell`: a tick's label sits beside the box
 * and reads as one target, where every other field's label sits above its
 * control. Forcing it through the shell would produce a label on its own line
 * above a lone box — the same markup, worse to use.
 *
 * **`name` is what makes radios a group**, and it is required for `radio` by the
 * type rather than optional: a radio without one is not mutually exclusive with
 * anything, which is the entire reason a screen chose a radio. A checkbox does
 * not take one, because a checkbox that is grouped is still independent.
 *
 * The hint is `aria-describedby`-linked for the same reason `FieldShell` links
 * its own: a hint a screen reader never reaches is decoration.
 */
export function ChoiceField(
  props: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    hint?: string | null;
    disabled?: boolean;
  } & ({ type?: 'checkbox'; name?: never } | { type: 'radio'; name: string }),
): ReactNode {
  const { label, checked, onChange, hint = null, disabled = false } = props;
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <>
      <label className="field field--choice" htmlFor={id}>
        <input
          id={id}
          type={props.type ?? 'checkbox'}
          {...(props.type === 'radio' ? { name: props.name } : {})}
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => {
            onChange(e.target.checked);
          }}
        />
        <span>{label}</span>
      </label>
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </>
  );
}

/**
 * **A single boolean the person states about what they are entering.**
 *
 * Kept as its own name rather than folded into `ChoiceField`, because *«is this
 * ticked»* is what almost every caller means and `type="checkbox"` on each of
 * them would be noise. It delegates, so there is still one markup.
 */
export function CheckboxField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string | null;
  disabled?: boolean;
}): ReactNode {
  return <ChoiceField {...props} />;
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

/**
 * A local calendar date, `YYYY-MM-DD` — never an instant (TD-11).
 *
 * **`DatePicker` plus the shared `FieldShell`, and nothing else** — the native
 * `<input type="date">` this used to keep is retired platform-wide (Owner
 * decision, 2026-09-05): it rendered its placeholder and its own popup in the
 * BROWSER's locale, which `lang`, `dir` and CSS could none of them touch, and a
 * platform that is Arabic everywhere else showed an English date shape at the
 * one control a person uses to state her own birth date. `date-picker.tsx`
 * carries the full account of why a real Arabic calendar replaces it and what
 * that trade costs and buys.
 *
 * **The bounds are no longer native.** A native `min`/`max` "greys out what
 * cannot be chosen" in the browser's own picker; `DatePicker` does the identical
 * job in its own grid — a day/month/year outside range is rendered disabled —
 * and the reasoning is unchanged: this is a courtesy, not validation. A native
 * `min` was always trivially bypassed and said nothing about *why*, so a caller
 * that sets one must still pass `error` and the server must still refuse.
 * Constrain, explain, and enforce stay three separate jobs; this still does
 * only the first.
 */
export function DateField(props: BaseProps & { min?: string; max?: string }): ReactNode {
  return (
    <FieldShell {...props}>
      {({ id, describedBy }) => (
        <DatePicker
          id={id}
          value={props.value}
          onChange={props.onChange}
          {...(props.min ? { min: props.min } : {})}
          {...(props.max ? { max: props.max } : {})}
          required={props.required ?? false}
          disabled={props.disabled ?? false}
          ariaInvalid={props.error ? true : undefined}
          ariaDescribedBy={describedBy}
        />
      )}
    </FieldShell>
  );
}

export function NumberField({
  min,
  max,
  /** The increment the value moves in — and, with it, the precision the browser
   *  will accept. R81's grades store two decimals, so a finer step would be
   *  rounded on the way in and read back as a different number. */
  step,
  ...props
}: BaseProps & { min?: number; max?: number; step?: number | string }): ReactNode {
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
          {...(step === undefined ? {} : { step })}
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
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  /**
   * A rule the reader needs *while typing* — TD-10's two-character floor is the
   * case that added it. A placeholder cannot carry it: the placeholder
   * disappears at the first keystroke, which is exactly when the floor starts
   * mattering. Wired through `aria-describedby` like every other field's hint.
   */
  hint?: string;
}): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
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
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
