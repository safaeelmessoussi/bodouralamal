import { useEffect, useState, type ReactNode } from 'react';

import { searchDirectory, type DirectoryEntry } from '../../adapters/users.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { SearchInput, SelectField } from '../ui/field.js';

export type AuthorRole = 'teacher' | 'assistant' | 'admin' | 'student';

/** R215 — who made an item: a person (or nobody) and, beside them, a capacity. */
export interface AuthorValue {
  id: string | null;
  name: string | null;
  role: '' | AuthorRole;
}

export const NO_AUTHOR: AuthorValue = { id: null, name: null, role: '' };

/**
 * **R215 — «إعداد»: who made this item** (the Owner, 2026-10-10: a recording
 * by its main teacher or an assistant, a file prepared by a teacher, an
 * administrator or a student). Optional. The person is found in the
 * administration's directory (`/admin/directory`, two letters at least), so it
 * is offered to administrators only — the caller decides (rule O). Every
 * reader then sees the person's PUBLIC name, resolved by the server.
 */
export function AuthorPicker({
  value,
  onChange,
  token,
  disabled = false,
}: {
  value: AuthorValue;
  onChange: (next: AuthorValue) => void;
  token: string | null;
  disabled?: boolean;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<DirectoryEntry[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || value.id !== null) {
      setFound([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchDirectory(token, { q })
        .then((page) => {
          if (!cancelled) setFound(page.data.slice(0, 8));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, token, value.id]);

  return (
    <fieldset className="author-picker" data-author-picker disabled={disabled}>
      <legend className="field__label">{t('content.author.label')}</legend>
      {value.id !== null ? (
        <p className="author-picker__chosen">
          <span>{value.name}</span>{' '}
          <Button variant="ghost" onClick={() => onChange(NO_AUTHOR)}>
            {t('content.author.clear')}
          </Button>
        </p>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={setQuery}
            label={t('content.author.search')}
            hint={t('content.author.searchHint')}
          />
          {found.length > 0 ? (
            <ul className="author-picker__results">
              {found.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="author-picker__result"
                    onClick={() => {
                      onChange({ id: person.id, name: person.name_arabic, role: value.role });
                      setQuery('');
                    }}
                  >
                    {person.name_arabic}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <SelectField
        label={t('content.author.roleLabel')}
        value={value.role}
        disabled={value.id === null}
        onChange={(role) => onChange({ ...value, role: role as AuthorValue['role'] })}
        options={[
          { value: '', label: t('content.author.none') },
          { value: 'teacher', label: t('content.author.role.teacher') },
          { value: 'assistant', label: t('content.author.role.assistant') },
          { value: 'admin', label: t('content.author.role.admin') },
          { value: 'student', label: t('content.author.role.student') },
        ]}
      />
    </fieldset>
  );
}

/** What an upload's `content_meta` carries for it. */
export function authorMeta(value: AuthorValue): { author_id?: string; author_role?: AuthorRole } {
  if (value.id === null) return {};
  return { author_id: value.id, ...(value.role !== '' ? { author_role: value.role } : {}) };
}
