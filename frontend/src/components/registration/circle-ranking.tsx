import type { ReactNode } from 'react';

import type { CircleSlot, CircleSlots } from '../../adapters/registrations.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { CheckboxField } from '../ui/field.js';

/**
 * **«رتّبي الحلقات التي تناسبك»** (SRS Revision 168 §1).
 *
 * A first-time مستفيدة ticks the memorisation circles she can attend and orders
 * them, most convenient first — one, two or all of them. What is on offer comes
 * from the server (`GET /registration/circle-slots`: the SCHEDULED classes of
 * her Category's first Level at her branch), never from a list this form knows,
 * so a Level with nothing to choose between simply renders nothing here.
 *
 * Operable by keyboard and on a phone: a checkbox to include a circle, and ↑/↓
 * buttons to move it — no drag, which neither of those can do. It is a wish and
 * says so: the administration still places her.
 */

/** «الثلاثاء 15:00–20:00» — pure, and tested. */
export function meetingLabel(meeting: CircleSlot['meetings'][number]): string {
  const days = meeting.weekdays.map((day) => t(`scheduling.weekday.${day}`)).join(' و');
  return `${days} ${meeting.start_time}–${meeting.end_time}`;
}

export function circleLabel(circle: CircleSlot): string {
  return `${circle.name} — ${circle.meetings.map(meetingLabel).join('، ')}`;
}

/** Tick adds at the END of her order; untick removes. Pure. */
export function toggleCircle(order: readonly string[], id: string, include: boolean): string[] {
  if (include) return order.includes(id) ? [...order] : [...order, id];
  return order.filter((entry) => entry !== id);
}

/** Moves one circle up (−1) or down (+1) in her order. Pure. */
export function moveCircle(order: readonly string[], id: string, by: -1 | 1): string[] {
  const at = order.indexOf(id);
  const to = at + by;
  if (at === -1 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}

export function CircleRanking({
  slots,
  value,
  onChange,
  error,
}: {
  slots: CircleSlots;
  value: string[];
  onChange: (next: string[]) => void;
  error: string | null;
}): ReactNode {
  // Fewer than two is not a choice, and nothing is asked.
  if (slots.circles.length < 2) return null;

  const byId = new Map(slots.circles.map((circle) => [circle.teaching_group_id, circle]));
  const ranked = value.filter((id) => byId.has(id));
  const unranked = slots.circles.filter((circle) => !ranked.includes(circle.teaching_group_id));

  return (
    <div className="circle-ranking" data-circle-ranking>
      <p className="field__label">{t('register.circles.label')}</p>
      <p className="field__hint">{t('register.circles.hint')}</p>

      {ranked.length > 0 ? (
        <ol className="circle-ranking__order" aria-label={t('register.circles.orderLabel')}>
          {ranked.map((id, index) => (
            <li key={id} className="circle-ranking__item" data-ranked-circle={id}>
              <span className="circle-ranking__rank">{index + 1}</span>
              <span className="circle-ranking__name">{circleLabel(byId.get(id)!)}</span>
              <span className="circle-ranking__moves">
                <Button
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => onChange(moveCircle(ranked, id, -1))}
                  aria-label={t('register.circles.moveUp')}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === ranked.length - 1}
                  onClick={() => onChange(moveCircle(ranked, id, 1))}
                  aria-label={t('register.circles.moveDown')}
                >
                  ↓
                </Button>
                <Button variant="ghost" onClick={() => onChange(toggleCircle(ranked, id, false))}>
                  {t('register.circles.remove')}
                </Button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {unranked.map((circle) => (
        <CheckboxField
          key={circle.teaching_group_id}
          label={circleLabel(circle)}
          checked={false}
          onChange={() => onChange(toggleCircle(ranked, circle.teaching_group_id, true))}
        />
      ))}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {slots.fixed.length > 0 ? (
        <p className="field__hint" data-fixed-classes>
          {t('register.circles.fixed')}{' '}
          {slots.fixed.map((entry) => `${entry.subject_name} — ${meetingLabel(entry)}`).join('، ')}
        </p>
      ) : null}
    </div>
  );
}
