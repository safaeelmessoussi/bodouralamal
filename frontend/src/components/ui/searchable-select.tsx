import { useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from './button.js';
import { FieldShell } from './field.js';
import { Icon } from './icon.js';
import { useDisclosure } from '../../lib/use-disclosure.js';
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
 * * **Collapsed by default (R137 item 8).** The control reads exactly like
 *   `SelectField` until opened — a `field__control`-styled trigger showing the
 *   chosen answer or the placeholder, nothing else — so a form mixing a plain
 *   select and a searchable one does not read as two different kinds of
 *   control. It used to render every option inline, always; that traded a
 *   short form for a long one on every screen that used it, which is the
 *   defect this collapses away. Opening it (click, Enter or Space on the
 *   trigger — a native `<button>` gets both for free) shows exactly what it
 *   showed before.
 * * **Opening shows every option the caller passed**, immediately.
 * * **Typing filters them**, matching anywhere in the label but ranking a
 *   prefix match first — typing the beginning of a name is the common case and
 *   should not bury it under a substring hit.
 * * Below `searchThreshold` options the search box is not rendered at all: on a
 *   list of four it is noise.
 * * **Escape and a click outside both close it** — `useDisclosure`, the same
 *   behaviour `NotificationBell` already established for the header's own
 *   popover, reused rather than reinvented.
 *
 * ## What it deliberately does not do
 *
 * **It fetches nothing and authorises nothing.** The caller passes the options
 * it is allowed to offer and this renders them — the same division
 * `LevelSelect` and `MultiSelectField` state, and the reason a screen can adopt
 * this component without any risk of widening what it shows.
 *
 * **It is not a native `<select>` and not a full ARIA combobox.** A `<select>`
 * cannot be searched, and a combobox needs `aria-activedescendant` keyboard
 * management this platform builds nowhere else — so the open panel is a real
 * `role="listbox"` of real, focusable `<button>` options: the keyboard and a
 * screen reader get the same affordance the pointer does, with none of a
 * combobox's roving-focus machinery.
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
  const { open, setOpen, toggle, containerRef } = useDisclosure<HTMLDivElement>();
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const chosen = options.find((o) => o.value === value) ?? null;
  const matches = useMemo(() => filterOptions(options, query), [options, query]);
  const searchable = options.length >= searchThreshold;

  function choose(v: string): void {
    onChange(v);
    setQuery('');
    setOpen(false);
    // Closing on an actual choice returns focus to the control that now holds
    // the answer — the same thing a native `<select>` does on its own.
    triggerRef.current?.focus();
  }

  return (
    <FieldShell label={label} hint={hint} required={required}>
      {({ id, describedBy }) => (
        <div className="dropdown-select searchable-select" ref={containerRef}>
          <div className="dropdown-select__control">
            <button
              id={id}
              ref={triggerRef}
              type="button"
              className="field__control dropdown-trigger"
              aria-haspopup="listbox"
              aria-expanded={open}
              disabled={disabled}
              aria-describedby={describedBy}
              onClick={toggle}
            >
              <span className="dropdown-trigger__label">
                {chosen ? (
                  <>
                    <strong>{chosen.label}</strong>
                    {chosen.hint ? <span className="muted"> — {chosen.hint}</span> : null}
                  </>
                ) : (
                  (placeholder ?? t('common.choose'))
                )}
              </span>
              <Icon name="chevron" size={16} />
            </button>
            {chosen ? (
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange('')}
                aria-label={`${t('common.remove')} — ${chosen.label}`}
              >
                ✕
              </Button>
            ) : null}
          </div>

          {open ? (
            options.length === 0 ? (
              <p className="field__hint">{emptyLabel ?? t('states.empty')}</p>
            ) : (
              <div className="dropdown-select__panel" role="listbox" aria-label={label}>
                {searchable ? (
                  // Opening the panel IS the request to type — the trigger just
                  // had focus, so moving it into the search box costs nothing.
                  <input
                    className="field__control"
                    type="search"
                    value={query}
                    disabled={disabled}
                    placeholder={t('common.searchPlaceholder')}
                    aria-label={searchLabel ?? `${t('common.search')} — ${label}`}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                ) : null}

                <ul className="searchable-select__options">
                  {matches.length === 0 ? (
                    <li className="field__hint">{t('common.noMatches')}</li>
                  ) : (
                    matches.map((o) => (
                      <li key={o.value} role="option" aria-selected={o.value === value}>
                        <Button
                          variant={o.value === value ? 'secondary' : 'ghost'}
                          disabled={disabled}
                          onClick={() => choose(o.value)}
                        >
                          {o.label}
                          {o.hint ? <span className="muted"> — {o.hint}</span> : null}
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )
          ) : null}
        </div>
      )}
    </FieldShell>
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
