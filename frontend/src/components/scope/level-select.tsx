import type { ReactNode } from 'react';

import { SelectField } from '../ui/field.js';
import { t } from '../../i18n/index.js';

/**
 * **The one Level selector.** Every place a Level is chosen renders through it,
 * so the label format is defined once.
 *
 * ## The format is `{Category} — {Level}`, and it is not decoration
 *
 * `المرأة — فرصة أمل`. **Level names are not unique across Categories and are
 * not numbered uniformly** (§4.4b — no Category is guaranteed a level 0), so a
 * bare name genuinely fails to identify one: two Categories may each have a
 * *فرصة أمل*, and a selector offering both twice is a selector nobody can use.
 * The Category is what disambiguates, which is why it belongs in the option and
 * not merely near it.
 *
 * Four screens had built this list themselves and **only one included the
 * Category**, so the same Level read differently depending on where you met it.
 *
 * ## It filters nothing
 *
 * The caller passes the Levels it is allowed to offer, and this renders them.
 * Authorization and narrowing stay where they already are — §4.4's rule that
 * *"the client never filters a list it was handed"* — so migrating a screen onto
 * this component cannot widen what it shows.
 */
export interface LevelOption {
  id: string;
  name: string;
  /** Absent for a source that does not carry it; the label degrades to the
   *  bare name rather than rendering an em dash with nothing before it. */
  category_name?: string | null;
}

/** The label, exported so a caller rendering Levels in a table reads the same. */
export function levelLabel(level: LevelOption): string {
  return level.category_name ? `${level.category_name} — ${level.name}` : level.name;
}

export function LevelSelect({
  levels,
  value,
  onChange,
  label,
  placeholder,
  hint,
  busy = false,
  disabled = false,
}: {
  levels: readonly LevelOption[];
  value: string | null;
  onChange: (levelId: string) => void;
  /** Defaults to §14.1's own word for the concept. */
  label?: string;
  placeholder?: string;
  hint?: string;
  busy?: boolean;
  disabled?: boolean;
}): ReactNode {
  return (
    <SelectField
      label={label ?? t('admin.nav.levels')}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder ?? t('common.choose')}
      options={levels.map((level) => ({ value: level.id, label: levelLabel(level) }))}
      busy={busy}
      disabled={disabled}
      {...(hint === undefined ? {} : { hint })}
    />
  );
}
