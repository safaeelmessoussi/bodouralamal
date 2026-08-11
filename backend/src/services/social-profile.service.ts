import type { PrismaClient, StudentSocialProfile } from '../generated/prisma/client.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import type { Actor } from '../policies/actor.js';
import { assertCanAccessStudent } from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * StudentSocialProfile — minors' case-file data (SRS §4.10, BR-16, TD-2 R28).
 *
 * The most restricted surface in the system. BR-16 makes it need-to-know:
 * visible only to Admins/Super Admins and the student's **specifically-assigned**
 * teachers — never to students, never to guardians **including the child's own
 * linked parents**, and never to teachers at large.
 *
 * Three properties are load-bearing, and none of them is UI's job:
 *
 *   - **Scope is resolved server-side through the §4.2 predicate.** A Teacher
 *     reaches a student only via a live `GroupTeacher` assignment to a group the
 *     student is enrolled in; an Admin only within their branch scope.
 *   - **TD-12 freshness applies per request.** TD-12 names *any
 *     `StudentSocialProfile` read* as high-risk, so a suspended teacher holding
 *     an unexpired token loses access immediately rather than at token expiry.
 *   - **Out of scope answers `404`, never `403`** (§20 rule 17). A `403` would
 *     confirm that a particular child has a case file.
 *
 * Both reads and writes are audited (TD-8 `socialprofile.view` /
 * `socialprofile.update`): viewing a safeguarding record is itself a
 * security-sensitive act, so the trail answers *who looked at this child's file*
 * and not merely who changed it. The update row records **which fields changed,
 * never their values** — §14's no-PII-in-logs rule applies to the audit detail
 * as much as to application logs.
 */

/** TD-2 R28: the three roles with any access at all. */
const PROFILE_ROLES = ['admin', 'super_admin', 'teacher'] as const;

/** §7 — the case-file fields. Anything outside this set is not a profile field. */
const PROFILE_FIELDS = [
  'healthCondition',
  'familySituation',
  'homeAddress',
  'siblingsCount',
  'fatherName',
  'fatherProfession',
  'motherName',
  'motherProfession',
] as const;

export type ProfileInput = Partial<Record<(typeof PROFILE_FIELDS)[number], string | number | null>>;

export interface ProfileView {
  studentId: string;
  healthCondition: string | null;
  familySituation: string | null;
  homeAddress: string | null;
  siblingsCount: number | null;
  fatherName: string | null;
  fatherProfession: string | null;
  motherName: string | null;
  motherProfession: string | null;
}

function toView(studentId: string, row: StudentSocialProfile | null): ProfileView {
  return {
    studentId,
    healthCondition: row?.healthCondition ?? null,
    familySituation: row?.familySituation ?? null,
    homeAddress: row?.homeAddress ?? null,
    siblingsCount: row?.siblingsCount ?? null,
    fatherName: row?.fatherName ?? null,
    fatherProfession: row?.fatherProfession ?? null,
    motherName: row?.motherName ?? null,
    motherProfession: row?.motherProfession ?? null,
  };
}

/**
 * Resolves the caller and asserts they may reach this student at all.
 *
 * The order matters: freshness first (is this caller still who the token says),
 * then scope. A suspended caller must not even learn whether the student is in
 * scope, so the freshness failure comes first and is a plain `403` about the
 * caller, while every scope failure is an indistinguishable `404`.
 */
async function authorize(
  prisma: PrismaClient,
  /**
   * R60 — the full caller, not a bare id. The **active role** has to reach
   * `assertFreshActive` (which rebuilds from live rows and would otherwise hand
   * back this account's full authority) and the audit row (§60.8). Threading the
   * `Actor` rather than a second `activeRole` parameter keeps the two from
   * drifting apart, which is why the id alone is no longer enough.
   */
  caller: Actor,
  studentId: string,
): Promise<{ userId: string; roles: string[] }> {
  // R60 — the FRESH, narrowed roles are returned, not the token's. A caller
  // acting as مؤطِّرة must be audited and evaluated as مؤطِّرة even when the
  // account also holds Admin.
  const actor = await assertFreshActive(prisma, caller.userId, PROFILE_ROLES, caller.activeRole);
  // The narrowed scopes, so §4.2's per-role resolution runs on the role being
  // exercised rather than on every role the account holds.
  await assertCanAccessStudent(prisma, { userId: actor.userId, roleScopes: actor.roleScopes }, studentId);
  return { userId: actor.userId, roles: actor.roles };
}

/** `GET /students/{id}/social-profile` — audited read (TD-8 R28). */
export async function readProfile(
  prisma: PrismaClient,
  caller: Actor,
  studentId: string,
): Promise<ProfileView> {
  const acting = await authorize(prisma, caller, studentId);

  const row = await prisma.studentSocialProfile.findFirst({
    where: { studentId, deletedAt: null },
  });

  // Audited even when no profile exists yet: the attempt to look is the event.
  await audit.write(prisma, {
    actorUserId: acting.userId,
    actionType: 'socialprofile.view',
    targetEntity: 'StudentSocialProfile',
    targetId: row?.id ?? studentId,
    detail: { student_id: studentId, actor_roles: acting.roles, existed: row !== null },
  });

  return toView(studentId, row);
}

/**
 * `PUT /students/{id}/social-profile` — audited upsert (TD-2 R28).
 *
 * Upsert rather than create/update: a case file is conceptually one record per
 * student (`student_id` is unique in §7), and staff should not have to know
 * whether one exists yet.
 */
export async function writeProfile(
  prisma: PrismaClient,
  caller: Actor,
  studentId: string,
  input: ProfileInput,
): Promise<ProfileView> {
  const acting = await authorize(prisma, caller, studentId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.studentSocialProfile.findFirst({
      where: { studentId, deletedAt: null },
    });

    // Only the fields actually supplied are written, so a partial update never
    // blanks a colleague's entry by omission.
    const data = Object.fromEntries(
      PROFILE_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f] ?? null]),
    );

    const row = existing
      ? await tx.studentSocialProfile.update({ where: { id: existing.id }, data })
      : await tx.studentSocialProfile.create({ data: { ...data, studentId } });

    await audit.write(tx, {
      actorUserId: acting.userId,
      actionType: 'socialprofile.update',
      targetEntity: 'StudentSocialProfile',
      targetId: row.id,
      // Field NAMES only — §14 forbids PII in logs, and the audit detail is no
      // exception: recording a child's health condition here would move the
      // very data BR-16 restricts into a table with a different access rule.
      detail: {
        student_id: studentId,
        fields_changed: Object.keys(data),
        created: existing === null,
      },
    });

    return toView(studentId, row);
  });
}
