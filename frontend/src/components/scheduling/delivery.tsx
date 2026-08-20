import type { ReactNode } from 'react';

import { SelectField } from '../ui/field.js';
import { t } from '../../i18n/index.js';

/**
 * **R97 — طريقة الحضور, as one concept with one implementation** (rule C).
 *
 * Delivery appears on the scheduling form, the occurrence editor, four
 * calendars, the occurrence table and the details dialog. That is seven places
 * that must agree on what *«عن بُعد»* is called and on what the answer even is —
 * so the words live in one catalogue (`delivery.*`) and the reading of the wire
 * fields lives in the two functions below.
 *
 * **A component never decides authorization here** (rule O): this renders what
 * the row says and offers what the caller permits. The server refuses an
 * incompatible combination regardless (`policies/delivery.ts`), and hiding a
 * control is not enforcement.
 */

export type DeliveryMode = 'in_person' | 'online';
export type OnlineMediaMode = 'audio_video' | 'audio_only';

/** The wire shape every surface receives — sessions carry it, an Event does not
 *  and sends `null`, which reads as *this kind has no delivery model*. */
export interface DeliveryFacts {
  delivery_mode: string | null;
  online_media_mode: string | null;
}

/**
 * *«حضوري»* or *«عن بُعد»* — and **`null` when the occurrence has no delivery at
 * all**, which is the honest answer for an Event and an Exam rather than a
 * default that states something the row does not hold.
 */
export function deliveryLabel(o: DeliveryFacts): string | null {
  if (o.delivery_mode !== 'in_person' && o.delivery_mode !== 'online') return null;
  return t(`delivery.${o.delivery_mode}`);
}

/** *«صوت وصورة»* / *«صوت فقط»*, and `null` for anything that is not online — the
 *  media mode is meaningless off an online row and the server refuses to store
 *  one there. */
export function mediaLabel(o: DeliveryFacts): string | null {
  if (o.delivery_mode !== 'online') return null;
  if (o.online_media_mode !== 'audio_video' && o.online_media_mode !== 'audio_only') return null;
  return t(`delivery.${o.online_media_mode}`);
}

/**
 * **One line answering *where does this happen***, for a table cell or a list.
 *
 * In person → the room, or nothing when the class has no room (§4.4c allows it).
 * Online → *«عن بُعد»*, optionally with the media mode.
 *
 * The **Branch is deliberately not part of this** (R97, §8 of the delivery
 * slice): a Branch is the administrative and educational scope of a class, not
 * its venue, and an online class is still a Targa class. Callers render the
 * branch in the column that means branch.
 */
export function venueLabel(
  o: DeliveryFacts & { room_name?: string | null },
  options: { withMedia?: boolean } = {},
): string | null {
  if (o.delivery_mode === 'online') {
    const media = options.withMedia === true ? mediaLabel(o) : null;
    const online = t('delivery.online');
    return media ? `${online} · ${media}` : online;
  }
  return o.room_name ?? null;
}

/**
 * **The delivery fields, shared by every form that schedules a teaching
 * occurrence** (§13, §14, §15 of R97's slice).
 *
 * One section, three callers: the back-office class form, the same form as the
 * مؤطِّرة reaches it, and the single-occurrence editor. A second copy is how one
 * screen ends up offering *«صوت فقط»* for an in-person class while the other
 * does not — the exact drift rule C exists for.
 *
 * **Irrelevant controls are HIDDEN, not disabled** (§13). A greyed-out room
 * selector on an online class is a control that looks like it could matter; the
 * absent one says what is true. The caller is responsible for **clearing** what
 * it hides — `onMode` below does it, so a room chosen before switching to عن
 * بُعد is never submitted.
 */
export function DeliverySection({
  mode,
  onMode,
  mediaMode,
  onMediaMode,
  rooms,
  roomId,
  onRoom,
  disabled = false,
}: {
  mode: DeliveryMode;
  /** Receives the new mode **and is expected to clear what the new mode makes
   *  meaningless** — the parent owns the state, so it does the clearing. */
  onMode: (next: DeliveryMode) => void;
  mediaMode: OnlineMediaMode;
  onMediaMode: (next: OnlineMediaMode) => void;
  rooms: { id: string; name: string; capacity: number | null }[];
  roomId: string;
  onRoom: (next: string) => void;
  disabled?: boolean;
}): ReactNode {
  const chosenRoom = rooms.find((r) => r.id === roomId);

  return (
    <>
      <SelectField
        label={t('delivery.label')}
        value={mode}
        onChange={(v) => onMode(v as DeliveryMode)}
        disabled={disabled}
        hint={t('delivery.hint')}
        options={[
          { value: 'in_person', label: t('delivery.in_person') },
          { value: 'online', label: t('delivery.online') },
        ]}
      />

      {mode === 'online' ? (
        <>
          <SelectField
            label={t('delivery.mediaLabel')}
            value={mediaMode}
            onChange={(v) => onMediaMode(v as OnlineMediaMode)}
            disabled={disabled}
            hint={t('delivery.mediaHint')}
            options={[
              { value: 'audio_video', label: t('delivery.audio_video') },
              { value: 'audio_only', label: t('delivery.audio_only') },
            ]}
          />
          {/* Said rather than left to be inferred from an absent control: a
              reader looking for the room selector should learn why it is gone,
              and that the Branch above still means something (rule AK keeps this
              short line from wrapping like prose). */}
          <p className="muted field__note">{t('delivery.noRoomWhenOnline')}</p>
        </>
      ) : (
        <SelectField
          label={t('admin.schedules.room')}
          value={roomId}
          onChange={onRoom}
          disabled={disabled}
          // BR-23 and §20 rule 22: capacity **informs and refuses nothing**. It
          // is a hint beside the choice, never a limit — the platform must not
          // refuse a booking on this number.
          hint={
            chosenRoom?.capacity != null
              ? t('admin.schedules.roomCapacityHint').replace('{n}', String(chosenRoom.capacity))
              : undefined
          }
          options={[
            { value: '', label: t('admin.schedules.noRoom') },
            ...rooms.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      )}
    </>
  );
}
