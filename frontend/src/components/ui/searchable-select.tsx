import type { ReactNode } from 'react';

import { Dropdown, filterOptions as filterDropdownOptions, SEARCH_THRESHOLD, type DropdownOption } from './dropdown.js';
import { FieldShell } from './field.js';
import { t } from '../../i18n/index.js';

/**
 * **R224 §3 — now drawn by the platform's one `Dropdown`**: the same trigger and
 * panel as every list, its search box past 30 options (`searchThreshold`).
 * The text below records why a searchable choice exists at all.
 *
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
export type SearchableOption = DropdownOption;

export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  hint,
  emptyLabel,
  disabled = false,
  required = false,
  searchThreshold = SEARCH_THRESHOLD,
  onQueryChange,
}: {
  label: string;
  options: readonly SearchableOption[];
  /** `''` is *nothing chosen*. */
  value: string;
  onChange: (value: string) => void;
  /** The empty choice's words; absent, «اختيار…». */
  placeholder?: string;
  hint?: string;
  /** Kept for callers; the search box is labelled by the field. */
  searchLabel?: string;
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  /** Past this many options the panel opens on a search box. */
  searchThreshold?: number;
  /** R217 — what is typed, for a caller whose list is longer than what it passes. */
  onQueryChange?: (query: string) => void;
}): ReactNode {
  return (
    <FieldShell label={label} {...(hint ? { hint } : {})} required={required}>
      {({ id, describedBy }) => (
        <Dropdown
          id={id}
          label={label}
          className="searchable-select"
          options={options}
          value={value}
          onChange={onChange}
          placeholder={placeholder ?? t(required ? 'common.choose' : 'common.noneChosen')}
          disabled={disabled}
          required={required}
          searchThreshold={searchThreshold}
          {...(describedBy ? { describedBy } : {})}
          {...(emptyLabel ? { emptyLabel } : {})}
          {...(onQueryChange ? { onQueryChange } : {})}
        />
      )}
    </FieldShell>
  );
}

/** Prefix matches first, then anything containing the needle (see `dropdown.tsx`). */
export function filterOptions(options: readonly SearchableOption[], query: string): SearchableOption[] {
  return filterDropdownOptions(options, query);
}
