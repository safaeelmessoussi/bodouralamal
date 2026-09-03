import type { Prisma } from '../generated/prisma/client.js';

/**
 * **Session protection — the semantic rule, and its single extensibility
 * point** (SRS §4.4, Revision 43.6).
 *
 * > A Session is protected whenever it holds data created by a user or an
 * > administrator **whose loss or silent modification would change historical
 * > truth.**
 *
 * That sentence is the rule. Attendance, grades, recordings, notes,
 * evaluations, certificates, behavioural reports — and whatever is not yet
 * imagined — are **instances** of it, never clauses of it. An implementer asking
 * *"is my new thing protected?"* answers by asking whether losing it would
 * misrepresent what happened, not by checking whether someone remembered to add
 * it to a list.
 *
 * **Why this is a registry and not a growing `if` chain.** A hardcoded list is a
 * list every future module must remember to join, and the module that forgets
 * does not fail loudly — it silently loses a safeguard. Worse, a module would
 * have to reach into scheduling to add its clause, so scheduling would slowly
 * accumulate knowledge of attendance, grading and messaging. Here the dependency
 * points the other way: **a module contributes a rule knowing nothing about
 * schedules, materialization or regeneration.**
 *
 * ---
 *
 * ## Contributing a rule
 *
 * ```ts
 * // in the evaluations module — imports nothing from scheduling
 * registerSessionProtectionRule({
 *   code: 'HAS_EVALUATION',
 *   describes: 'an evaluation was recorded against this session',
 *   async evaluate(tx, sessions) {
 *     const rows = await tx.evaluation.findMany({
 *       where: { sessionId: { in: sessions.map((s) => s.id) }, deletedAt: null },
 *       select: { sessionId: true },
 *     });
 *     return new Set(rows.map((r) => r.sessionId));
 *   },
 * });
 * ```
 *
 * **Attendance was this example until R123 shipped it as a built-in** — see the
 * note on `BUILT_IN_RULES` for why a protection that a bootstrap call can omit
 * is not a protection.
 *
 * **Two properties are required of every rule and are not negotiable (§4.4):**
 *
 * 1. **Evaluated in bulk.** `evaluate` receives *all* candidate sessions and
 *    returns the subset it protects, so protection costs one query per rule
 *    rather than one per session. At a full academic-year horizon a per-session
 *    check would be an N+1 wearing a guard's clothing.
 * 2. **A rule may only ADD protection.** There is no mechanism to un-protect a
 *    session, deliberately: a subtractive rule would let one module overrule
 *    another module's safeguard, and no module is in a position to know that is
 *    safe.
 *
 * The **built-in rules below are always present** rather than registered at
 * boot. A protection that can be switched off by forgetting to call a bootstrap
 * function is not a protection, and a test that forgets it would pass while the
 * safeguard was absent.
 */

/** The intrinsic fields every rule may read without a query of its own. */
export interface ProtectableSession {
  id: string;
  date: Date;
  overridden: boolean;
  status: string;
}

/** The Prisma `select` that produces a `ProtectableSession`. Exported with the
 *  type so a caller cannot drift by selecting the wrong columns and silently
 *  getting an unprotected answer. */
export const SELECT_PROTECTABLE = {
  id: true,
  date: true,
  overridden: true,
  status: true,
} as const;

export interface SessionProtectionRule {
  /** Stable code. Appears in the API response and in the `session.regenerate`
   *  audit row, so it is part of the contract — renaming one is a breaking
   *  change to an administrator's record of why something was spared. */
  readonly code: string;
  /** Why this rule exists, in the terms an administrator would use. Surfaced
   *  when they are asked to confirm an overwrite. */
  readonly describes: string;
  /** The subset of `sessions` this rule protects. ONE query for all of them. */
  evaluate(
    tx: Prisma.TransactionClient,
    sessions: readonly ProtectableSession[],
  ): Promise<Set<string>> | Set<string>;
}

/**
 * The rules that hold for every deployment, with no registration step.
 *
 * Each is an instance of the semantic rule above:
 *
 * - **`OVERRIDDEN`** — someone deliberately decided about this occurrence.
 *   Discarding that decision would misrepresent what was arranged.
 * - **`STATUS_HELD` / `STATUS_CANCELLED`** — it happened, or its absence is
 *   itself a record. Rewriting either changes what is true of the past.
 * - **`HAS_CONTENT`** — a recording, homework or materials someone attached.
 *   Losing the link orphans real work.
 * - **`HAS_ATTENDANCE`** — somebody was recorded as present. §20 rule 24 names
 *   attendance explicitly, and a register is the clearest case of the semantic
 *   rule there is: regenerating the occurrence would leave marks pointing at a
 *   class that no longer exists, or lose them outright.
 *
 * **`HAS_ATTENDANCE` is a built-in rather than a contributed rule**, although
 * the doc-comment above shows attendance as the example of contribution. The
 * argument for registration is dependency direction, and it is real — but this
 * file already reads `session_content`, so the direction was never pure, and
 * the stronger property is the one stated two paragraphs up: **a protection
 * that can be switched off by forgetting to call a bootstrap function is not a
 * protection**, and `resetContributedRules` can switch a contributed one off
 * inside a test. Registration remains the pattern for a rule whose data lives
 * behind an optional module; attendance is not optional.
 */
const BUILT_IN_RULES: SessionProtectionRule[] = [
  {
    code: 'OVERRIDDEN',
    describes: 'someone deliberately changed this occurrence',
    evaluate: (_tx, sessions) => new Set(sessions.filter((s) => s.overridden).map((s) => s.id)),
  },
  {
    code: 'LIFECYCLE',
    describes: 'this occurrence has already been held or cancelled',
    evaluate: (_tx, sessions) =>
      new Set(sessions.filter((s) => s.status !== 'scheduled').map((s) => s.id)),
  },
  {
    code: 'HAS_CONTENT',
    describes: 'educational content is attached to this occurrence',
    async evaluate(tx, sessions) {
      if (sessions.length === 0) return new Set();
      const rows = await tx.sessionContent.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) }, deletedAt: null },
        select: { sessionId: true },
      });
      return new Set(rows.map((r) => r.sessionId));
    },
  },
  {
    code: 'HAS_ATTENDANCE',
    describes: 'attendance has been recorded for this occurrence',
    async evaluate(tx, sessions) {
      if (sessions.length === 0) return new Set();
      // ONE query for every candidate, as every rule must be: at a full
      // academic-year horizon a per-session check is an N+1 wearing a guard's
      // clothing.
      const rows = await tx.attendance.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) }, deletedAt: null },
        select: { sessionId: true },
      });
      return new Set(rows.flatMap((r) => (r.sessionId === null ? [] : [r.sessionId])));
    },
  },
];

/** Rules contributed by modules at bootstrap. Separate from the built-ins so a
 *  missing registration can never disable a core protection. */
const CONTRIBUTED_RULES: SessionProtectionRule[] = [];

/**
 * Adds a module's protection condition.
 *
 * Called once at bootstrap by the module that owns the data — never by
 * scheduling, which must not know what kinds of work exist. Registering the same
 * `code` twice is a programming error and throws rather than silently shadowing:
 * two rules under one code would make an audit row ambiguous about which
 * safeguard applied.
 */
export function registerSessionProtectionRule(rule: SessionProtectionRule): void {
  const clash = [...BUILT_IN_RULES, ...CONTRIBUTED_RULES].find((r) => r.code === rule.code);
  if (clash) {
    throw new Error(
      `A session protection rule with code '${rule.code}' is already registered. Codes appear in audit rows, so two rules cannot share one.`,
    );
  }
  CONTRIBUTED_RULES.push(rule);
}

/** Every rule currently in force. Exposed for the test that asserts the
 *  built-ins are present without a bootstrap step. */
export function sessionProtectionRules(): readonly SessionProtectionRule[] {
  return [...BUILT_IN_RULES, ...CONTRIBUTED_RULES];
}

/** Removes contributed rules. Test support only — the built-ins are untouched,
 *  because a suite must never be able to run with the core protection off. */
export function resetContributedRules(): void {
  CONTRIBUTED_RULES.length = 0;
}

/**
 * **The single authoritative answer to "is this session protected, and why".**
 *
 * Every scheduling operation asks this and nothing else — materialization,
 * schedule edit, schedule deletion, regeneration, and anything added later
 * (§4.4). A scheduling path that answers the question privately is a defect,
 * because the first copy to drift takes a real safeguard with it, silently.
 *
 * Returns **all** applicable reasons rather than the first: a session may be
 * both already held *and* carrying a recording, and an administrator deciding
 * whether to overwrite it deserves both facts.
 */
export async function protectionReasons(
  tx: Prisma.TransactionClient,
  sessions: readonly ProtectableSession[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (sessions.length === 0) return out;

  for (const rule of sessionProtectionRules()) {
    const protectedIds = await rule.evaluate(tx, sessions);
    for (const id of protectedIds) {
      const existing = out.get(id);
      if (existing) existing.push(rule.code);
      else out.set(id, [rule.code]);
    }
  }
  return out;
}

/** Convenience for the single-session case; same mechanism, no second path. */
export async function protectionReasonsFor(
  tx: Prisma.TransactionClient,
  session: ProtectableSession,
): Promise<string[]> {
  return (await protectionReasons(tx, [session])).get(session.id) ?? [];
}

/** The human-readable descriptions behind a set of codes, for the confirmation
 *  an administrator is shown before overwriting (§4.4, Revision 43.5). */
export function describeProtection(codes: readonly string[]): string[] {
  const byCode = new Map(sessionProtectionRules().map((r) => [r.code, r.describes]));
  return codes.map((c) => byCode.get(c) ?? c);
}
