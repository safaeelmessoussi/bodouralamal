import type { DeliveryMode, OnlineMediaMode } from "../generated/prisma/client.js";

/**
 * **R97 — how a teaching occurrence is delivered, as ONE fact.**
 *
 * `delivery_mode`, `online_media_mode` and `room_id` are three columns holding
 * one decision, and this module is the single place that resolves them. Every
 * write path asks it: schedule create, schedule update, the R50 split, and
 * `session.override`.
 *
 * ## The rule
 *
 * | delivery | `online_media_mode` | `room_id` |
 * |---|---|---|
 * | `in_person` | `null` | whatever was chosen (§4.4c allows none) |
 * | `online`    | `audio_video` \| `audio_only` | **`null`** |
 *
 * Both halves are database CHECKs (`*_delivery_check`,
 * `*_online_no_room_check`). This function is what makes a *partial* edit
 * arrive at a state those CHECKs accept, rather than letting the constraint
 * name be the error message an administrator sees.
 *
 * ## Why a room is CLEARED rather than ignored
 *
 * The alternative was to leave a stale `room_id` on an online row and teach
 * conflict detection to skip it. That puts the rule in one query and leaves the
 * calendar, the details dialog, the session list — and whatever is written next
 * — free to render a venue for a class that has none. Clearing it makes the bad
 * state unrepresentable, so **room-collision detection needs no special case at
 * all**: an online occurrence has nothing to collide over. Staff-time conflicts
 * are a different fact and stay real — a مؤطِّرة cannot deliver an online class
 * and an in-person one in the same hour.
 *
 * ## What delivery is NOT
 *
 * It is not audience (R92) and it is not staffing (R91). Moving a class online
 * changes neither who is expected at it nor who teaches it, and nothing here
 * touches either. It is also not a *provider*: no media platform is named in
 * this module, in the schema, or anywhere in R97.
 */
export interface Delivery {
  deliveryMode: DeliveryMode;
  onlineMediaMode: OnlineMediaMode | null;
  roomId: string | null;
}

export type DeliveryPatch = {
  deliveryMode?: DeliveryMode | undefined;
  onlineMediaMode?: OnlineMediaMode | null | undefined;
  roomId?: string | null | undefined;
};

/**
 * Applies a partial edit to a current delivery state and returns the columns to
 * write — always all three, because writing one of them alone is what produces
 * a row the CHECK refuses.
 *
 * **`undefined` means *unchanged*, `null` means *cleared*.** The distinction is
 * the same one every `PATCH` on this platform makes, and collapsing it here
 * would make "leave the room as it is" indistinguishable from "remove it".
 */
export function resolveDelivery(
  current: Delivery,
  patch: DeliveryPatch,
): Delivery {
  const deliveryMode = patch.deliveryMode ?? current.deliveryMode;
  const roomId = patch.roomId === undefined ? current.roomId : patch.roomId;

  if (deliveryMode === "online") {
    return {
      deliveryMode,
      // The boundary refuses `online` without a media mode when the mode is
      // named, so the fallback covers only the edit that leaves delivery alone.
      onlineMediaMode:
        patch.onlineMediaMode === undefined
          ? current.onlineMediaMode
          : patch.onlineMediaMode,
      roomId: null,
    };
  }
  return { deliveryMode, onlineMediaMode: null, roomId };
}

/** The delivery an unstated create defaults to — what every class the
 *  association has scheduled on this platform has actually been. */
export const DEFAULT_DELIVERY: Delivery = {
  deliveryMode: "in_person",
  onlineMediaMode: null,
  roomId: null,
};
