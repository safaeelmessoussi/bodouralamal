import { useId, useMemo, useState, type ReactNode } from 'react';

import { Button } from './button.js';
import { t } from '../../i18n/index.js';

/**
 * **Choosing several things from a list that may be long.**
 *
 * The platform had no such control, so the one place needing it — the
 * assistants on a schedule, an exam and an event — rendered **every** person as
 * a checkbox. With a handful of مؤطرات that reads fine; with the association's
 * actual roster it turns a short form into a page of checkboxes and buries the
 * fields below it.
 *
 * ## What it is, and what it deliberately is not
 *
 * **Not a combobox.** A `<select multiple>` is famously hard to use — ctrl-click
 * to add, and a mis-click loses the whole selection — so this is a **search box
 * over a bounded list, plus the chosen items shown as removable chips**. The
 * selection is always visible and never one keystroke from being lost.
 *
 * **The chosen are separated from the choosable**, which is what makes the
 * control readable at any list length: what you have picked is a short list at
 * the top, and what you may still pick is filtered below.
 *
 * **Search is presentational.** It narrows options the caller already handed
 * over; it fetches nothing and filters no authorization. The caller stays
 * responsible for offering only what it may — the same division the shared
 * Level selector states.
 *
 * **Excluding an option is the caller's job too** (the lead مؤطرة must not also
 * be an assistant, §20 rule 22's distinction between two roles on one thing) —
 * this component has no opinion about *why* something is not offered.
 */
export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelectField({
  label,
  options,
  selected,
  onChange,
  hint,
  searchPlaceholder,
  emptyLabel,
  disabled = false,
  required = false,
  error = null,
  /** Below this many options the search box is noise rather than help. */
  searchThreshold = 8,
}: {
  label: string;
  options: readonly MultiSelectOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  hint?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string | null;
  searchThreshold?: number;
}): ReactNode {
  const id = useId();
  const [query, setQuery] = useState('');

  const chosen = useMemo(
    () => selected.map((v) => options.find((o) => o.value === v)).filter((o) => o !== undefined),
    [selected, options],
  );

  const available = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter(
      (o) => !selected.includes(o.value) && (needle === '' || o.label.toLowerCase().includes(needle)),
    );
  }, [options, selected, query]);

  const searchable = options.length >= searchThreshold;

  return (
    <fieldset
      className={error ? 'field field--invalid multi-select' : 'field multi-select'}
      aria-invalid={error ? true : undefined}
      aria-describedby={
        [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
          .filter(Boolean)
          .join(' ') || undefined
      }
    >
      <legend className="field__label">
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>

      {chosen.length > 0 ? (
        <ul className="multi-select__chosen">
          {chosen.map((o) => (
            <li key={o.value}>
              {/* Removing is a button, not an × glyph in a span: it is an action
                  and needs the role, the focus ring and the accessible name. */}
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(selected.filter((v) => v !== o.value))}
                aria-label={`${t('common.remove')} — ${o.label}`}
              >
                {o.label} ✕
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint">{emptyLabel ?? t('common.noneChosen')}</p>
      )}

      {searchable ? (
        <input
          id={`${id}-search`}
          className="field__control"
          type="search"
          value={query}
          disabled={disabled}
          placeholder={searchPlaceholder ?? t('common.search')}
          aria-label={`${t('common.search')} — ${label}`}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}

      <ul className="multi-select__options">
        {available.length === 0 ? (
          <li className="field__hint">{t('common.noMatches')}</li>
        ) : (
          available.map((o) => (
            <li key={o.value}>
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange([...selected, o.value])}
              >
                ＋ {o.label}
              </Button>
            </li>
          ))
        )}
      </ul>

      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
