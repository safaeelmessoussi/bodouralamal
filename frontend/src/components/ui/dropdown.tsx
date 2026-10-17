import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { useDisclosure } from '../../lib/use-disclosure.js';
import { Icon } from './icon.js';

/**
 * **SRS Revision 224 §3 — the platform's one dropdown** (the Owner,
 * 2026-10-16: «they all should look same thing, like same drop down, with the
 * addition … of what is different in that drop down»).
 *
 * Every single-choice list is drawn by this: the same trigger, the same panel
 * opening below it, a search box as the panel's first line when the list is
 * longer than {@link SEARCH_THRESHOLD} items (typing filters the options
 * beneath it), arrows and Escape on the keyboard. The browser's own list is
 * gone from the platform: in a dialog it opened and closed at once on the
 * Owner's Chrome («إضافة مجموعة»).
 *
 * **A native `<select>` stays in the page, hidden and in step** — it carries
 * the field's id (the label points at it), its options and its value, so
 * whatever reads or drives a form through a `<select>` (the browser harnesses
 * do) keeps working. It is out of the tab order and of the accessibility tree;
 * the visible trigger is the control.
 *
 * It fetches nothing and authorises nothing: the caller passes what it may
 * offer, in its order.
 */
export const SEARCH_THRESHOLD = 30;

export interface DropdownOption {
  value: string;
  label: string;
  /** Secondary context shown beside the label, and searched too. */
  hint?: string;
}

export function Dropdown({
  id,
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  triggerClassName = 'field__control',
  className = '',
  searchThreshold = SEARCH_THRESHOLD,
  emptyLabel,
  onQueryChange,
}: {
  /** The field's id — on the hidden native select, which the label names. */
  id: string;
  /** The field's label, read by assistive technology on the trigger. */
  label: string;
  options: readonly DropdownOption[];
  /** `''` is *nothing chosen*. */
  value: string;
  onChange: (value: string) => void;
  /** The empty choice's words («اختيار…», «بدون», «الكل»); absent, there is none. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  triggerClassName?: string;
  className?: string;
  searchThreshold?: number;
  emptyLabel?: string;
  onQueryChange?: (query: string) => void;
}): ReactNode {
  const { open, setOpen, containerRef } = useDisclosure<HTMLDivElement>();
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    if (open) fitPanel(containerRef.current);
  }, [open, containerRef]);

  const chosen = options.find((o) => o.value === value) ?? null;
  const searchable = options.length > searchThreshold;
  const choices = useMemo<DropdownOption[]>(
    () => [...(placeholder !== undefined ? [{ value: '', label: placeholder }] : []), ...options],
    [options, placeholder],
  );
  const matches = useMemo(() => filterOptions(choices, query), [choices, query]);

  function close(focusTrigger: boolean): void {
    setOpen(false);
    setQuery('');
    onQueryChange?.('');
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(next: string): void {
    if (next !== value) onChange(next);
    close(true);
  }

  function openPanel(focusFirst: boolean): void {
    if (disabled) return;
    setUp(opensUp(containerRef.current));
    setOpen(true);
    if (focusFirst && !searchable) {
      window.setTimeout(() => {
        const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button');
        const selected = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"] button');
        (selected ?? buttons?.[0])?.focus();
      }, 0);
    }
  }

  /** Arrows move between options, Home/End to the ends, Escape closes. */
  function onPanelKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      // Kept from the dialog around it: Escape closes the list, not the form.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(buttons.length - 1, at + 1)
            : Math.max(0, at - 1);
    buttons[next]?.focus();
  }

  // R224 §3 — nothing chosen reads «اختيار…» when an answer is required, «بدون» otherwise.
  const shown = chosen ? chosen.label : (placeholder ?? t(required ? 'common.choose' : 'common.noneChosen'));
  return (
    <div className={`dropdown-select single-select ${up ? 'opens-up' : ''} ${className}`.replace(/\s+/g, ' ').trim()} ref={containerRef}>
      {/* In step with the trigger, for whatever drives the form through it. */}
      <select
        id={id}
        className="dropdown-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => triggerRef.current?.focus()}
      >
        {placeholder !== undefined || !chosen ? <option value="">{placeholder ?? ''}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerClassName} dropdown-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${shown}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? close(false) : openPanel(false))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openPanel(true);
          }
        }}
      >
        <span className={chosen ? 'dropdown-trigger__label' : 'dropdown-trigger__label is-empty'} title={shown}>
          {chosen ? (
            <>
              {chosen.label}
              {chosen.hint ? <span className="muted"> — {chosen.hint}</span> : null}
            </>
          ) : (
            shown
          )}
        </span>
        <Icon name="chevron" size={16} />
      </button>

      {open ? (
        <div className="dropdown-select__panel" onKeyDown={onPanelKey}>
          {searchable ? (
            <input
              className="field__control dropdown-search"
              type="search"
              value={query}
              placeholder={t('common.searchPlaceholder')}
              aria-label={`${t('common.search')} — ${label}`}
              onChange={(e) => {
                setQuery(e.target.value);
                onQueryChange?.(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  listRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                }
                if (e.key === 'Enter' && matches.length > 0) {
                  e.preventDefault();
                  choose(matches[0]!.value);
                }
              }}
              autoFocus
            />
          ) : null}
          {options.length === 0 && placeholder === undefined ? (
            <p className="field__hint">{emptyLabel ?? t('common.noOptions')}</p>
          ) : (
            <ul className="dropdown-options searchable-select__options" role="listbox" aria-label={label} ref={listRef}>
              {matches.length === 0 ? (
                <li className="field__hint">{t('common.noMatches')}</li>
              ) : (
                matches.map((o) => (
                  <li key={o.value === '' ? '__empty' : o.value} role="option" aria-selected={o.value === value}>
                    <button
                      type="button"
                      className={o.value === value ? 'dropdown-option is-selected' : 'dropdown-option'}
                      data-option-value={o.value}
                      onClick={() => choose(o.value)}
                    >
                      <span className={o.value === '' ? 'muted' : undefined}>{o.label}</span>
                      {o.hint ? <span className="muted"> — {o.hint}</span> : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * **Prefix matches first, then anything containing the needle**; an empty
 * query keeps the caller's order. Case- and diacritic-insensitive enough for
 * Arabic and Latin names alike.
 */
export function filterOptions<T extends DropdownOption>(options: readonly T[], query: string): T[] {
  const needle = fold(query.trim());
  if (needle === '') return [...options];
  const prefix: T[] = [];
  const contains: T[] = [];
  for (const option of options) {
    const label = fold(option.label);
    if (label.startsWith(needle)) prefix.push(option);
    else if (`${label} ${fold(option.hint ?? '')}`.includes(needle)) contains.push(option);
  }
  return [...prefix, ...contains];
}

/** Lower case, Arabic short vowels and tatweel dropped, alef forms joined. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/**
 * R225 — whether a list opened here should open upward: too little room below
 * on the screen, and more above. Read when the list opens.
 */
export function opensUp(container: HTMLElement | null, needed = 300): boolean {
  if (!container) return false;
  const rect = container.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  return below < needed && rect.top > below;
}

/**
 * R226 — once a list is open, keep it on the screen: if it runs past either
 * edge from the control's start, it lines up with the control's end instead.
 */
export function fitPanel(container: HTMLElement | null): void {
  if (!container) return;
  container.classList.remove('aligns-end');
  const panel = container.querySelector<HTMLElement>('.dropdown-select__panel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  if (rect.left < 0 || rect.right > document.documentElement.clientWidth) container.classList.add('aligns-end');
}
