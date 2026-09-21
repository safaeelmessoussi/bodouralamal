import { readFileSync, statSync } from 'node:fs';

/**
 * **Morocco's official time, read from the HOST's zone database — never from
 * the copy frozen inside an image** (Document Owner, 2026-09-21 — SRS Revision
 * 167 §2: *«the time in Morocco will change again; I want the platform to follow
 * the time zone used in Morocco»*).
 *
 * ## What went wrong
 *
 * Morocco moved to UTC+0 on Sunday 20 September 2026. The host knew the same
 * day — Ubuntu ships `tzdata` updates automatically — and the platform did not:
 * Node converts local time with the ICU zone data COMPILED INTO ITS BINARY
 * (`process.versions.tz`), and a container image freezes that, and its own
 * `tzdata` package, on the day it was built. So every exam opening computed from
 * a wall-clock time, every «today», and every time printed into a recording's
 * title was an hour ahead of the country, and would have stayed so until
 * somebody rebuilt the images — and gone wrong again at the next decree.
 *
 * ## The rule
 *
 * One file is the authority: the host's `Africa/Casablanca` TZif, bind-mounted
 * read-only over the container's own `/usr/share/zoneinfo` (Compose, `api` and
 * `db`). This module parses it, answers from it, and re-reads it when it
 * changes — so a `tzdata` update on the host reaches a RUNNING platform within
 * minutes, with no rebuild, no release and no restart.
 *
 * **Nothing in `src/` may read the process's local clock** (`getHours`,
 * `new Date(y, m, d, …)`, `toLocale…` without an explicit zone): those go
 * through ICU. `TZ` stays set only so that a line this rule missed fails by an
 * hour rather than by a whole zone.
 *
 * ## If the file cannot be read
 *
 * The answer falls back to ICU and SAYS SO (`clockStatus().source`): wrong by
 * at most the staleness of the image, never silently.
 *
 * Dates and class times are unaffected by any of this — they are `date` and
 * `time` columns and carry no zone (TD-11). This is about INSTANTS.
 */
export const MOROCCO_ZONE = 'Africa/Casablanca';

const ZONE_FILE = process.env['MOROCCO_ZONEINFO_FILE'] ?? `/usr/share/zoneinfo/${MOROCCO_ZONE}`;
/** How often a changed file is looked for. A `stat` costs nothing; a decree is
 *  followed within this long of the host learning about it. */
const RECHECK_MS = 5 * 60 * 1000;

export interface ZoneRules {
  /** Instants (ms since the epoch) at which the offset changes, ascending. */
  transitions: number[];
  /** `offsets[i]` applies from `transitions[i]` on, in MINUTES east of UTC. */
  offsets: number[];
  /** In force before the first transition. */
  initialOffset: number;
}

/**
 * Parses a TZif file (RFC 8536). Version 2+ files carry a second, 64-bit block
 * after the 32-bit one; that is the one read, because a "slim" file's first
 * block is empty. The POSIX footer is ignored deliberately: Morocco's rules
 * follow a lunar calendar and cannot be written as one, so `zic` enumerates
 * every transition explicitly (through 2087).
 */
export function parseTzif(file: Uint8Array): ZoneRules {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const magic = String.fromCharCode(...file.subarray(0, 4));
  if (magic !== 'TZif') throw new Error('not a TZif file');
  const version = file[4] === 0 ? 1 : Number(String.fromCharCode(file[4]!));

  const header = (at: number) => ({
    isutcnt: view.getUint32(at + 20),
    isstdcnt: view.getUint32(at + 24),
    leapcnt: view.getUint32(at + 28),
    timecnt: view.getUint32(at + 32),
    typecnt: view.getUint32(at + 36),
    charcnt: view.getUint32(at + 40),
  });

  let at = 0;
  let h = header(at);
  let timeSize = 4;
  if (version >= 2) {
    // Skip the whole v1 block to reach the 64-bit one.
    at += 44 + h.timecnt * 5 + h.typecnt * 6 + h.charcnt + h.leapcnt * 8 + h.isstdcnt + h.isutcnt;
    h = header(at);
    timeSize = 8;
  }
  let p = at + 44;

  const times: number[] = [];
  for (let i = 0; i < h.timecnt; i += 1) {
    const seconds = timeSize === 8 ? Number(view.getBigInt64(p)) : view.getInt32(p);
    times.push(seconds * 1000);
    p += timeSize;
  }
  const typeIndex: number[] = [];
  for (let i = 0; i < h.timecnt; i += 1) typeIndex.push(file[p + i]!);
  p += h.timecnt;

  const typeOffsets: number[] = [];
  for (let i = 0; i < h.typecnt; i += 1) {
    typeOffsets.push(Math.round(view.getInt32(p + i * 6) / 60));
  }
  if (typeOffsets.length === 0) throw new Error('TZif file names no local time type');

  return {
    transitions: times,
    offsets: typeIndex.map((index) => typeOffsets[index] ?? typeOffsets[0]!),
    // RFC 8536 §3.2: local time type 0 applies before the first transition.
    initialOffset: typeOffsets[0]!,
  };
}

/** Minutes east of UTC in force at `instant`. Binary search; the list is long. */
export function offsetFromRules(rules: ZoneRules, instant: number): number {
  let low = 0;
  let high = rules.transitions.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rules.transitions[mid]! <= instant) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found === -1 ? rules.initialOffset : rules.offsets[found]!;
}

type Source = 'host-zoneinfo' | 'icu-fallback';
let loaded: { rules: ZoneRules; mtimeMs: number } | null = null;
let lastChecked = 0;
let lastError: string | null = null;

function currentRules(now: number = Date.now()): ZoneRules | null {
  if (now - lastChecked < RECHECK_MS && (loaded !== null || lastError !== null)) {
    return loaded?.rules ?? null;
  }
  lastChecked = now;
  try {
    const { mtimeMs } = statSync(ZONE_FILE);
    if (loaded === null || loaded.mtimeMs !== mtimeMs) {
      loaded = { rules: parseTzif(readFileSync(ZONE_FILE)), mtimeMs };
    }
    lastError = null;
  } catch (error) {
    // Keep answering from the last good copy if there is one.
    lastError = error instanceof Error ? error.message : String(error);
  }
  return loaded?.rules ?? null;
}

/** ICU's answer — only when the zone file cannot be read, and it says so. */
function icuOffsetMinutes(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MOROCCO_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (type: string): number => Number(parts.find((x) => x.type === type)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/** Minutes east of UTC that Morocco observes at `instant`. */
export function moroccoOffsetMinutes(instant: Date = new Date()): number {
  const rules = currentRules();
  return rules === null
    ? icuOffsetMinutes(instant.getTime())
    : offsetFromRules(rules, instant.getTime());
}

export interface MoroccoParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What a clock on a wall in Morocco reads at `instant`. */
export function moroccoParts(instant: Date = new Date()): MoroccoParts {
  const shifted = new Date(instant.getTime() + moroccoOffsetMinutes(instant) * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Morocco's calendar date at `instant`, `YYYY-MM-DD`. */
export function moroccoDateIso(instant: Date = new Date()): string {
  const p = moroccoParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Morocco's wall-clock time at `instant`, `HH:MM`. */
export function moroccoTimeHHMM(instant: Date = new Date()): string {
  const p = moroccoParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The instant at which a wall clock in Morocco reads these values.
 *
 * Two passes, because the offset to subtract is the one in force AT THE ANSWER,
 * which is not known until the answer is. A time skipped by a forward change
 * resolves to the instant just after it; a time repeated by a backward change
 * resolves to its FIRST occurrence — the same choices `new Date(y, m, d, …)`
 * makes, so nothing that worked before behaves differently.
 */
export function moroccoWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = asUtc - moroccoOffsetMinutes(new Date(asUtc)) * 60_000;
  const second_ = asUtc - moroccoOffsetMinutes(new Date(first)) * 60_000;
  // When the two disagree the wall time straddles a change; the EARLIER
  // candidate that really reads back as the requested wall time wins.
  for (const candidate of [Math.min(first, second_), Math.max(first, second_)]) {
    if (candidate + moroccoOffsetMinutes(new Date(candidate)) * 60_000 === asUtc) {
      return new Date(candidate);
    }
  }
  return new Date(Math.max(first, second_));
}

export interface ClockStatus {
  source: Source;
  utc_offset_minutes: number;
  /** When the host's zone file last changed; `null` on the ICU fallback. */
  rules_updated_at: string | null;
  /** Since when the current offset has been in force — an instant EARLIER than
   *  this needs an older offset, which a client takes from its own zone data
   *  (old rules are the ones an outdated device does know). */
  in_force_since: string | null;
  /** The next change the rules know about, so a client can refresh in time. */
  next_change_at: string | null;
  error: string | null;
}

/**
 * Since when the offset at `instant` has been in force, and when it next
 * CHANGES. A zone file also lists transitions that change nothing — `zic`
 * writes one at the 32-bit limit, and a rule change can restate the offset
 * already in force — and only a change of offset moves a clock on a wall.
 */
export function offsetChangesAround(
  rules: ZoneRules,
  instant: number,
): { since: number | null; next: number | null } {
  const offset = offsetFromRules(rules, instant);
  let since: number | null = null;
  for (let i = 0; i < rules.transitions.length; i += 1) {
    const at = rules.transitions[i]!;
    if (at > instant) {
      if (rules.offsets[i] !== offset) return { since, next: at };
      continue;
    }
    const before = i === 0 ? rules.initialOffset : rules.offsets[i - 1]!;
    if (rules.offsets[i] !== before) since = at;
  }
  return { since, next: null };
}

export function clockStatus(now: Date = new Date()): ClockStatus {
  const rules = currentRules(now.getTime());
  const offset = moroccoOffsetMinutes(now);
  const { since, next } =
    rules === null ? { since: null, next: null } : offsetChangesAround(rules, now.getTime());
  return {
    source: rules === null ? 'icu-fallback' : 'host-zoneinfo',
    utc_offset_minutes: offset,
    in_force_since: since === null ? null : new Date(since).toISOString(),
    rules_updated_at: loaded === null ? null : new Date(loaded.mtimeMs).toISOString(),
    next_change_at: next === null ? null : new Date(next).toISOString(),
    error: lastError,
  };
}

/** Tests only: forget what was loaded, so a different file can be read. */
export function resetMoroccoClockForTests(): void {
  loaded = null;
  lastChecked = 0;
  lastError = null;
}
