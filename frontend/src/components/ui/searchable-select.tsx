import { useId, useMemo, useState, type ReactNode } from 'react';

import { Button } from './button.js';
import { t } from '../../i18n/index.js';

/**
 * **Choosing ONE thing from a list that may be long.**
 *
 * ## The defect it exists for
 *
 * The platform had `MultiSelectField` for *several* and `SelectField` for *few*,
 * and nothing for *one out of many* — so the screens that needed it invented a
 * **typed-search workflow** instead: the group roster's student picker returned
 * nothing at all until two characters had been typed, offering an empty list and
 * no affordance saying why.
 *
 * That is the one thing a picker must never do. **Search narrows what is
 * offered; it is never the thing that makes options exist.** A reader who does
 * not already know a name cannot type it, and a control that answers only
 * questions you could have answered yourself is not a picker.
 *
 * ## Behaviour
 *
 * * **Opening shows every option the caller passed**, immediately.
 * * **Typing filters them**, matching anywhere in the label but ranking a
 *   prefix match first — typing the beginning of a name is the common case and
 *   should not bury it under a substring hit.
 * * **The chosen option stays visible** above the list, with a clear control, so
 *   the current answer is never something you have to scroll to find.
 * * Below `searchThreshold` options the search box is not rendered at all: on a
 *   list of four it is noise.
 *
 * ## What it deliberately does not do
 *
 * **It fetches nothing and authorises nothing.** The caller passes the options
 * it is allowed to offer and this renders them — the same division
 * `LevelSelect` and `MultiSelectField` state, and the reason a screen can adopt
 * this component without any risk of widening what it shows.
 *
 * **It is not a native `<select>` and not an ARIA combobox.** A `<select>`
 * cannot be searched, and a combobox needs a popover, a focus trap and
 * `aria-activedescendant` keyboard management that this platform has nowhere
 * else — so it is built as a **search box over a visible list**, the shape
 * `MultiSelectField` already established. Everything in it is a real control, so
 * the keyboard and a screen reader get the affordance the pointer does for free.
 */
export interface SearchableOption {
  value: string;
  label: string;
  /** Secondary context shown beside the label — a branch, a Subject, a Level.
   *  Searched too, so a reader may narrow by the thing they remember. */
  hint?: string;
}

export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  hint,
  searchLabel,
  emptyLabel,
  disabled = false,
  required = false,
  /** Below this many options the search box is noise rather than help. */
  searchThreshold = 8,
}: {
  label: string;
  options: readonly SearchableOption[];
  /** `''` is *nothing chosen* — the same representation every selector on the
   *  platform uses, so a caller never has to translate between `null` and `''`. */
  value: string;
  onChange: (value: string) => void;
  /** What the empty selection reads as. */
  placeholder?: string;
  hint?: string;
  searchLabel?: string;
  /** Shown when the caller passed no options at all — a true statement about the
   *  data, which an empty list on its own would leave the reader to guess at. */
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  searchThreshold?: number;
}): ReactNode {
  const id = useId();
  const [query, setQuery] = useState('');

  const chosen = options.find((o) => o.value === value) ?? null;

  const matches = useMemo(() => filterOptions(options, query), [options, query]);
  const searchable = options.length >= searchThreshold;

  return (
    <fieldset className="field searchable-select" disabled={disabled}>
      <legend className="field__label">
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>

      {/* The current answer, always rendered — as a chip when something is
          chosen and as a sentence when nothing is, so the two states occupy the
          same place instead of one of them being the absence of the other. */}
      {chosen ? (
        <p className="searchable-select__chosen">
          <strong>{chosen.label}</strong>
          {chosen.hint ? <span className="muted"> — {chosen.hint}</span> : null}{' '}
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange('')}
            aria-label={`${t('common.remove')} — ${chosen.label}`}
          >
            ✕
          </Button>
        </p>
      ) : (
        <p className="field__hint">{placeholder ?? t('common.choose')}</p>
      )}

      {options.length === 0 ? (
        <p className="field__hint">{emptyLabel ?? t('states.empty')}</p>
      ) : (
        <>
          {searchable ? (
            <input
              id={`${id}-search`}
              className="field__control"
              type="search"
              value={query}
              disabled={disabled}
              placeholder={t('common.searchPlaceholder')}
              aria-label={searchLabel ?? `${t('common.search')} — ${label}`}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}

          <ul className="searchable-select__options">
            {matches.length === 0 ? (
              <li className="field__hint">{t('common.noMatches')}</li>
            ) : (
              matches.map((o) => (
                <li key={o.value}>
                  <Button
                    variant={o.value === value ? 'secondary' : 'ghost'}
                    disabled={disabled}
                    aria-pressed={o.value === value}
                    onClick={() => {
                      onChange(o.value);
                      // The query is cleared on choosing, so reopening the
                      // control shows the whole list again rather than whatever
                      // was last typed at it.
                      setQuery('');
                    }}
                  >
                    {o.label}
                    {o.hint ? <span className="muted"> — {o.hint}</span> : null}
                  </Button>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {hint ? <p className="field__hint">{hint}</p> : null}
    </fieldset>
  );
}

/**
 * **Prefix matches first, then anything containing the needle.**
 *
 * Exported for its own test: the ranking is the behaviour the Owner asked for
 * (*"easy to find options by typing the beginning of the label"*), and a
 * behaviour worth asking for is worth asserting directly rather than through a
 * rendered list.
 *
 * An empty query returns the options **in the order the caller gave them** —
 * the caller has already sorted them meaningfully, and re-sorting would discard
 * that.
 */
export function filterOptions(
  options: readonly SearchableOption[],
  query: string,
): SearchableOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...options];

  const prefix: SearchableOption[] = [];
  const contains: SearchableOption[] = [];
  for (const option of options) {
    const haystack = `${option.label} ${option.hint ?? ''}`.toLowerCase();
    if (option.label.toLowerCase().startsWith(needle)) prefix.push(option);
    else if (haystack.includes(needle)) contains.push(option);
  }
  return [...prefix, ...contains];
}
