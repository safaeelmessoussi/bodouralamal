import { useEffect, useState, type ReactNode } from 'react';

import { fetchSessionChoices, type SessionChoice, type SessionChoiceFilter } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { SearchableSelect } from '../ui/searchable-select.js';

/**
 * **R265 — «الحصة»: the class session an item belongs to, chosen in its own
 * form** (the Owner, 2026-11-12). The list follows the form: its Level, year,
 * Subject, Surah and branch narrow it (`GET /content/session-choices`), newest
 * first, upcoming ones included. Choosing one attaches the item to it when it
 * is saved, and its date ends the title.
 */
export function SessionChoiceField({
  filter,
  value,
  onChange,
  token,
  disabled = false,
}: {
  /** `null` while the form has no Level or year yet: nothing to list. */
  filter: SessionChoiceFilter | null;
  value: string;
  onChange: (choice: SessionChoice | null) => void;
  token: string | null;
  disabled?: boolean;
}): ReactNode {
  const [choices, setChoices] = useState<SessionChoice[]>([]);
  const key = filter === null ? '' : JSON.stringify(filter);
  useEffect(() => {
    if (filter === null) {
      setChoices([]);
      return undefined;
    }
    let live = true;
    void fetchSessionChoices(filter, token)
      .then((rows) => {
        if (live) setChoices(rows);
      })
      .catch(() => {
        if (live) setChoices([]);
      });
    return () => {
      live = false;
    };
    // `key` stands for `filter`, compared by value.
  }, [key, token]);

  return (
    <SearchableSelect
      label={t('content.session.label')}
      options={choices.map((choice) => ({ value: choice.id, label: choice.title }))}
      value={value}
      onChange={(id) => onChange(choices.find((choice) => choice.id === id) ?? null)}
      placeholder={t('content.session.none')}
      emptyLabel={filter === null ? t('content.session.chooseScope') : t('content.session.empty')}
      hint={t('content.session.hint')}
      disabled={disabled || filter === null}
    />
  );
}
