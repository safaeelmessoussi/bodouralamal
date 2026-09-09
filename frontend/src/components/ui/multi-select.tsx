import { useMemo, useRef, useState, type ReactNode } from 'react';

import { ChoiceField, FieldShell } from './field.js';
import { Icon } from './icon.js';
import { useDisclosure } from '../../lib/use-disclosure.js';
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
 * **Not a `<select multiple>`.** A `<select multiple>` is famously hard to use
 * — ctrl-click to add, and a mis-click loses the whole selection — so this
 * offers real checkboxes, one per option, which a pointer, a keyboard and a
 * screen reader all operate the identical way.
 *
 * **Collapsed by default (R137 item 8).** The control reads exactly like
 * `SelectField`/`SearchableSelect` until opened — the same `field__control`
 * trigger, showing a plain-language summary ("٣ محددة", the Owner's own
 * example) rather than the whole roster. It used to render every chosen chip
 * and every choosable option inline, always; on the association's real roster
 * that turned a short form into a page of checkboxes, which is the defect this
 * collapses away. Opening it (click, Enter or Space on the trigger) reveals the
 * SAME checkbox list as before — nothing about *what* is offered changed, only
 * *when* it takes up space on the screen.
 *
 * **Search is presentational.** It narrows options the caller already handed
 * over; it fetches nothing and filters no authorization. The caller stays
 * responsible for offering only what it may — the same division the shared
 * Level selector states.
 *
 * **Excluding an option is the caller's job too** (the lead مؤطرة must not also
 * be an assistant, §20 rule 22's distinction between two roles on one thing) —
 * this component has no opinion about *why* something is not offered.
 *
 * **Escape and a click outside both close the panel** — `useDisclosure`, the
 * same behaviour `NotificationBell` already established for the header's own
 * popover, reused rather than reinvented a third time.
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
  const { open, toggle, containerRef } = useDisclosure<HTMLDivElement>();
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const chosenCount = useMemo(
    () => options.filter((o) => selected.includes(o.value)).length,
    [options, selected],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === '' ? options : options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);

  const searchable = options.length >= searchThreshold;

  function toggleOption(value: string): void {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const summary =
    chosenCount === 0
      ? (emptyLabel ?? t('common.noneChosen'))
      : t('common.selectedCount').replace('{n}', String(chosenCount));

  return (
    <FieldShell label={label} error={error} hint={hint} required={required}>
      {({ id, describedBy }) => (
        <div className="dropdown-select multi-select" ref={containerRef}>
          <button
            id={id}
            ref={triggerRef}
            type="button"
            className="field__control dropdown-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onClick={toggle}
          >
            <span className="dropdown-trigger__label">{summary}</span>
            <Icon name="chevron" size={16} />
          </button>

          {open ? (
            <div className="dropdown-select__panel" role="group" aria-label={label}>
              {options.length === 0 ? (
                <p className="field__hint">{emptyLabel ?? t('common.noneChosen')}</p>
              ) : (
                <>
                  {searchable ? (
                    <input
                      className="field__control"
                      type="search"
                      value={query}
                      disabled={disabled}
                      placeholder={searchPlaceholder ?? t('common.search')}
                      aria-label={`${t('common.search')} — ${label}`}
                      onChange={(e) => setQuery(e.target.value)}
                      autoFocus
                    />
                  ) : null}

                  <ul className="multi-select__options">
                    {visible.length === 0 ? (
                      <li className="field__hint">{t('common.noMatches')}</li>
                    ) : (
                      visible.map((o) => (
                        <li key={o.value}>
                          <ChoiceField
                            label={o.label}
                            checked={selected.includes(o.value)}
                            disabled={disabled}
                            onChange={() => toggleOption(o.value)}
                          />
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </FieldShell>
  );
}
