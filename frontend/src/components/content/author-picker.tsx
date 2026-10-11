import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { searchDirectory, type DirectoryEntry } from '../../adapters/users.js';
import { t } from '../../i18n/index.js';
import { SearchableSelect } from '../ui/searchable-select.js';

export type AuthorRole = 'teacher' | 'assistant' | 'admin' | 'student' | 'guardian';

/** R215 — who made an item: a person, or nobody. */
export interface AuthorValue {
  id: string | null;
  name: string | null;
}

export const NO_AUTHOR: AuthorValue = { id: null, name: null };

/**
 * **R217 — «صاحب المحتوى»: one searchable list** (the Owner, 2026-10-11: «a
 * simple searchable drop down … listing only teachers, just to not make the
 * list too long with all the users of the platform, but allowing to search all
 * users»). Opened, it offers the مؤطِّرات; typing two letters searches every
 * person. Each name says the capacity the server will record — مؤطِّرة, else the
 * administration, else مستفيدة, else وليّ الأمر — read off the person's roles,
 * never chosen here. The directory is the administration's: the caller offers
 * this to administrators only (rule O).
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
  const [teachers, setTeachers] = useState<DirectoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<DirectoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all: DirectoryEntry[] = [];
      for (let page = 1; page <= 8; page += 1) {
        const batch = await searchDirectory(token, { role: 'teacher' }, page);
        all.push(...batch.data);
        if (batch.data.length === 0 || page * batch.meta.page_size >= batch.meta.total) break;
      }
      if (!cancelled) setTeachers(all);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchDirectory(token, { q })
        .then((page) => {
          if (!cancelled) setFound(page.data);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, token]);

  const options = useMemo(() => {
    const people = query.trim().length >= 2 ? found : teachers;
    const listed = people.map((person) => ({
      value: person.id,
      label: person.name_arabic,
      hint: roleLabel(authorRoleOf(person)),
    }));
    // The person already chosen stays nameable even when not in this list.
    if (value.id !== null && !listed.some((o) => o.value === value.id)) {
      listed.unshift({ value: value.id, label: value.name ?? '', hint: '' });
    }
    return listed;
  }, [query, found, teachers, value.id, value.name]);

  return (
    <div data-author-picker>
      <SearchableSelect
        label={t('content.author.label')}
        options={options}
        value={value.id ?? ''}
        onChange={(id) => {
          const person = [...found, ...teachers].find((p) => p.id === id);
          onChange(id === '' ? NO_AUTHOR : { id, name: person?.name_arabic ?? value.name });
        }}
        onQueryChange={setQuery}
        placeholder={t('content.author.none')}
        hint={t('content.author.searchHint')}
        searchThreshold={0}
        disabled={disabled}
      />
    </div>
  );
}

/** R217 — the capacity the server records, read the same way here for the hint. */
export function authorRoleOf(person: Pick<DirectoryEntry, 'roles'>): AuthorRole | null {
  const held = new Set(person.roles.map((r) => r.role));
  if (held.has('teacher')) return 'teacher';
  if (held.has('admin') || held.has('super_admin')) return 'admin';
  if (held.has('student')) return 'student';
  if (held.has('parent')) return 'guardian';
  return null;
}

const roleLabel = (role: AuthorRole | null): string => (role ? t(`content.author.role.${role}`) : '');

/** What an upload's `content_meta` carries: the person; the server reads the capacity. */
export function authorMeta(value: AuthorValue): { author_id?: string } {
  return value.id === null ? {} : { author_id: value.id };
}
