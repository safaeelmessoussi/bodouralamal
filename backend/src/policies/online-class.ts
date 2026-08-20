import { createHash } from "node:crypto";

import type { OnlineMediaMode } from "../generated/prisma/client.js";

/**
 * **R98 — the rules of joining an online class, with no vendor in sight.**
 *
 * Three decisions live here and nowhere else: **which room** an occurrence is,
 * **when** it may be entered, and **what a participant may do** once inside.
 * Every one of them is a statement about بذور الأمل's own domain, so none of
 * them may be answered by a media platform — which is the whole content of the
 * durable rule this section exists to establish:
 *
 * > **BODOUR AUTHORIZES; LIVEKIT EXECUTES THE MEDIA SESSION.**
 *
 * The inverse — reading room membership, or a provider's own notion of a
 * participant, as evidence of authorization — is what turns a media platform
 * into an identity provider for a platform serving minors. It is refused by
 * construction: nothing in this module or its callers ever *asks* the provider
 * anything.
 *
 * `lib/online-class-provider.ts` is the only file that knows LiveKit exists.
 */

/* ────────────────────────────── room identity ────────────────────────────── */

/**
 * **The room an occurrence is, DERIVED — never stored** (R97.9, R98.3).
 *
 * R97.9 forbids a provider identifier on `RecurringCourseSchedule`, `Session` or
 * the calendar projection, and this is how that is honoured rather than merely
 * respected: there is no column to forbid, because the name is a pure function
 * of the Session's own identity.
 *
 * ## What it is derived from, and what it is deliberately not
 *
 * The platform namespace, a **version tag**, and the Session's UUID. Not the
 * title, not the Subject, not a student's name and not a مؤطِّرة's — those are
 * personal data or free text, and a room name is visible to every participant
 * and to the provider's own operators. A hash of a v4 UUID is opaque and cannot
 * collide within this platform's lifetime.
 *
 * `v1` is in the input so a future change of scheme is a new namespace rather
 * than a silent reassignment of rooms that may be in progress.
 *
 * ## Knowing the name grants NOTHING
 *
 * This is not a secret and must never be treated as one. A room is entered with
 * a token this platform minted for one named participant after checking the R92
 * audience or the R91 assignment; a guessed name reaches a room the guesser
 * holds no token for. Opacity here is hygiene — it keeps the association's
 * timetable out of a third party's operational logs — never authorization.
 *
 * ## Idempotence is free
 *
 * Because it is derived, asking twice returns the same room, and a page refresh
 * creates nothing. LiveKit opens a room on the first join and closes it when the
 * last participant leaves; **no room is created ahead of time and no row records
 * one** (R98.17, R98.18).
 */
export function roomNameForSession(sessionId: string): string {
  const digest = createHash("sha256")
    .update(`bodour.online-class.v1:${sessionId}`)
    .digest("hex");
  return `bodour-${digest.slice(0, 32)}`;
}

/* ─────────────────────────────── join window ─────────────────────────────── */

/**
 * **How early the door opens.** Fifteen minutes: long enough for a مؤطِّرة to
 * be in the room and settled before her students arrive, short enough that a
 * token minted for the wrong occurrence of a weekly class is refused rather
 * than quietly accepted.
 */
export const JOIN_OPENS_MINUTES_BEFORE = 15;

/**
 * **How long the door stays open after the scheduled end.** Thirty minutes,
 * and it is a **reconnection** allowance rather than an invitation to arrive
 * late: a three-hour class that overruns, or a مؤطِّرة whose connection drops at
 * the last minute, must not find the platform refusing to let her back into a
 * class that is still happening.
 */
export const JOIN_GRACE_MINUTES_AFTER = 30;

/** A token is never minted for less than this, so a request landing on the last
 *  second of the window is still usable rather than expired on arrival. */
const MIN_TOKEN_SECONDS = 60;

/** And never for longer than this, whatever the window says. TD-12's posture is
 *  that a credential is short-lived; a class is a few hours, not a day. */
const MAX_TOKEN_SECONDS = 6 * 60 * 60;

export interface JoinWindow {
  opensAt: Date;
  closesAt: Date;
}

/**
 * **The occurrence's window, on the association's own clock.**
 *
 * A `Session` carries a calendar **date** and two wall-clock **times** (TD-11 —
 * never instants), so an instant only exists once a timezone is named. The
 * platform's is `TZ` (TD-13, `Africa/Casablanca`), which the API process runs
 * under; composing the parts with the local-time `Date` constructor is
 * therefore the association's own clock, which is the clock the timetable on the
 * wall is written in.
 *
 * **Server time decides.** The client's clock is never consulted, and `now` is a
 * parameter only so a test can state an instant rather than sleep to one.
 */
export function joinWindowFor(occurrence: {
  date: Date;
  startTime: Date;
  endTime: Date;
}): JoinWindow {
  const at = (time: Date): Date =>
    new Date(
      occurrence.date.getUTCFullYear(),
      occurrence.date.getUTCMonth(),
      occurrence.date.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds(),
    );

  const start = at(occurrence.startTime);
  const end = at(occurrence.endTime);
  // A class crossing midnight ends "before" it starts on the same calendar day.
  // The association has never scheduled one, and treating it as a zero-length
  // window would refuse a real class; rolling to the next day is the only
  // reading of the two times that is not nonsense.
  if (end.getTime() < start.getTime()) end.setDate(end.getDate() + 1);

  return {
    opensAt: new Date(start.getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000),
    closesAt: new Date(end.getTime() + JOIN_GRACE_MINUTES_AFTER * 60_000),
  };
}

export type WindowState = "open" | "too_early" | "too_late";

export function windowState(window: JoinWindow, now: Date): WindowState {
  if (now.getTime() < window.opensAt.getTime()) return "too_early";
  if (now.getTime() > window.closesAt.getTime()) return "too_late";
  return "open";
}

/** Seconds of validity for a token minted at `now`, bounded at both ends. */
export function tokenSecondsFor(window: JoinWindow, now: Date): number {
  const remaining = Math.ceil((window.closesAt.getTime() - now.getTime()) / 1000);
  return Math.min(MAX_TOKEN_SECONDS, Math.max(MIN_TOKEN_SECONDS, remaining));
}

/* ─────────────────────────────── participants ────────────────────────────── */

/**
 * **Why this person is in this room** — resolved from the platform's own
 * authorization and carried onward for display and audit.
 *
 * `assistant` is a *separate value from* `teacher` and gets *identical grants*
 * (§4.4c as revised by R87 §G / R91 §16): position is responsibility and audit,
 * never a weaker permission branch. Naming both and mapping both to the same
 * capability is what makes that parity a fact a test can read, rather than an
 * absence somebody later "tidies up".
 */
export type ParticipantRole = "teacher" | "assistant" | "student" | "admin";

/**
 * The permissions a participant is minted with. Deliberately the smallest set
 * that lets each kind of person do their job (R98.12) — in particular
 * **`roomAdmin` is not handed to everybody**, and a student never receives it.
 */
export interface ParticipantGrants {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  /** Moderation — muting a participant, removing one from the room. Teaching
   *  staff only; this is the one place the classroom differs by role. */
  roomAdmin: boolean;
  /**
   * **Which tracks may be published at all**, enforced by the provider rather
   * than by the interface.
   *
   * For an `audio_only` class this is the microphone alone, so «صوت فقط» is a
   * property of the *token* and not a CSS decision a modified client could undo
   * — the same posture §4.9 takes about a download URL.
   */
  canPublishSources: ("microphone" | "camera" | "screen_share")[];
}

export function grantsFor(
  role: ParticipantRole,
  media: OnlineMediaMode,
): ParticipantGrants {
  const sources: ParticipantGrants["canPublishSources"] =
    media === "audio_only"
      ? ["microphone"]
      : ["microphone", "camera", "screen_share"];

  // R87 §G — an assistant IS the main teacher for operational authorization on
  // the class she staffs. One branch, both positions.
  const teaching = role === "teacher" || role === "assistant";

  return {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: teaching,
    canPublishSources: sources,
  };
}
