import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { TITLE_FORMATS, type TitleFormat, type TitleNumbers } from '../../lib/content-title.js';
import { NumberField, SelectField } from '../ui/field.js';

/**
 * **R259 — the parts of a title that are kept nowhere but in it** (the Owner:
 * «not to be stored in the database, just in the interface … only used in
 * forming the title»): the format, the page, the session and the part. One
 * row, the same in the upload form and in the edit form.
 */
export function TitleNumbersFields({
  value,
  onChange,
  disabled = false,
}: {
  value: TitleNumbers;
  onChange: (next: TitleNumbers) => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <div className="title-numbers">
      <SelectField
        label={t('content.titleParts.format')}
        value={value.format}
        onChange={(format) => onChange({ ...value, format: format as TitleFormat | '' })}
        placeholder={t('content.titleParts.formatNone')}
        options={TITLE_FORMATS.map((format) => ({ value: format, label: format }))}
        disabled={disabled}
      />
      <NumberField
        label={t('content.titleParts.page')}
        value={value.page}
        onChange={(page) => onChange({ ...value, page })}
        min={1}
        step={1}
        disabled={disabled}
      />
      <NumberField
        label={t('content.titleParts.session')}
        value={value.session}
        onChange={(session) => onChange({ ...value, session })}
        min={1}
        step={1}
        disabled={disabled}
      />
      <NumberField
        label={t('content.titleParts.part')}
        value={value.part}
        onChange={(part) => onChange({ ...value, part })}
        min={1}
        step={1}
        disabled={disabled}
      />
    </div>
  );
}
