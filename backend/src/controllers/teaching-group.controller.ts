import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import * as teachingGroups from '../services/teaching-group.service.js';
import { pageParamsFrom } from '../lib/pagination.js';
import {
  pageOf,
  teachingGroupDeletionDto,
  teachingGroupDto,
  teachingGroupMemberDto,
  circleMemberDto,
  teachingGroupRowDto,
  unassignedStudentDto,
  type TeachingGroupListDto,
} from './dto.js';
import { idParam, parse } from './parse.js';
import {
  addTeachingGroupMemberSchema,
  createTeachingGroupSchema,
  listTeachingGroupsQuerySchema,
  updateTeachingGroupSchema,
} from '../validators/teaching-group.validators.js';

/**
 * Teaching Groups over HTTP (TD-3.12, §4.4c, BR-22, Revision 43).
 *
 * As everywhere: validate, call the service, project through a DTO. **The
 * Revision 43.3 authority split is not repeated here** — `assertCanManageGroups`
 * (Super Admin, because a Teaching Group is curriculum structure and carries no
 * branch to scope by) and `assertCanManageMembership` (Admin, scoped by the
 * branch the *student* is enrolled at) live in the service, which is also what
 * the jobs and tests that never reach Express go through.
 *
 * **The URL shape carries the identity.** `level_id` and `subject_id` are path
 * segments on the collection and are never accepted in a body, because the pair
 * is what a split *is* rather than a property it has.
 */

/**
 * The whole split for one `(Level, Subject)` in a single read.
 *
 * Two service calls, one response, deliberately: BR-22's unassigned list is
 * unreadable without the groups beside it — the screen's question is *who is
 * not placed, and where could they go* — and splitting it across two round trips
 * would let a client render half the answer.
 *
 * **Not paginated.** A split is bounded by one Level's enrolment, and a page
 * boundary drawn through the unassigned list would let a student who is
 * receiving no teaching in a subject fall onto page two of an alarm.
 */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const levelId = idParam(req, 'levelId');
    const subjectId = idParam(req, 'subjectId');

    const groups = await teachingGroups.listTeachingGroups(prisma, actor, levelId, subjectId);
    const unassigned = await teachingGroups.listUnassignedStudents(
      prisma,
      actor,
      levelId,
      subjectId,
    );

    const body: TeachingGroupListDto = {
      groups: groups.map(teachingGroupDto),
      split: unassigned.split,
      unassigned: unassigned.unassigned.map(unassignedStudentDto),
    };
    res.json(body);
  };
}

/**
 * `GET /admin/teaching-groups` — **every circle the caller may see**, paginated.
 *
 * The sibling of `list` above rather than a replacement for it: that one answers
 * *"how is this Subject split, and who is unplaced"* and carries BR-22's alarm;
 * this one answers *"what circles exist"* and carries a page. Neither can be
 * derived from the other without either an N+1 or a page boundary through an
 * alarm, which is why both exist.
 */
export function listAll(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const filters = parse(listTeachingGroupsQuerySchema, req.query);
    const result = await teachingGroups.listAllTeachingGroups(prisma, requireActor(req), {
      // Absent stays absent — the service's `where` builder distinguishes "not
      // filtering by Level" from "filtering by no Level".
      ...(filters.level_id !== undefined ? { levelId: filters.level_id } : {}),
      ...(filters.subject_id !== undefined ? { subjectId: filters.subject_id } : {}),
      ...(filters.category_id !== undefined ? { categoryId: filters.category_id } : {}),
      ...(filters.q !== undefined ? { q: filters.q } : {}),
      ...pageParamsFrom(req.query),
    });
    res.json(pageOf(result, teachingGroupRowDto));
  };
}

/**
 * `GET /admin/teaching-groups/{id}/members` — the circle's roster.
 *
 * Completes a collection whose `POST` and `DELETE` were already specified
 * (TD-3.12) and whose `GET` was missing, which is why the `DELETE` had no caller:
 * nothing could show who was in a circle in order to take them out.
 */
export function listMembers(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await teachingGroups.listMembers(prisma, requireActor(req), idParam(req, 'id'));
    res.json({ data: rows.map(circleMemberDto) });
  };
}

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const input = parse(createTeachingGroupSchema, req.body ?? {});
    const group = await teachingGroups.createTeachingGroup(prisma, requireActor(req), {
      levelId: idParam(req, 'levelId'),
      subjectId: idParam(req, 'subjectId'),
      name: input.name,
      ...(input.display_order !== undefined ? { displayOrder: input.display_order } : {}),
    });
    // A freshly created split has no members; the count is stated rather than
    // queried, so the response shape never varies by verb.
    res.status(201).json(teachingGroupDto({ ...group, memberCount: 0 }));
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const input = parse(updateTeachingGroupSchema, req.body ?? {});
    const group = await teachingGroups.updateTeachingGroup(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      {
        version: input.version,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.display_order !== undefined ? { displayOrder: input.display_order } : {}),
      },
    );
    const memberCount = await prisma.studentTeachingGroup.count({
      where: { teachingGroupId: group.id, deletedAt: null },
    });
    res.json(teachingGroupDto({ ...group, memberCount }));
  };
}

/** `200`, not `204` — see `teachingGroupDeletionDto`: BR-22 forbids a silent release. */
export function remove(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await teachingGroups.deleteTeachingGroup(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
    );
    res.json(teachingGroupDeletionDto(result));
  };
}

/* ── Membership (§4.4c — at most one seat per (student, subject, level)) ─── */

export function addMember(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const input = parse(addTeachingGroupMemberSchema, req.body ?? {});
    const teachingGroupId = idParam(req, 'id');
    const row = await teachingGroups.addMember(
      prisma,
      requireActor(req),
      teachingGroupId,
      input.student_id,
    );
    res
      .status(201)
      .json(teachingGroupMemberDto({ id: row.id, studentId: input.student_id, teachingGroupId }));
  };
}

export function removeMember(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await teachingGroups.removeMember(
      prisma,
      requireActor(req),
      idParam(req, 'id'),
      idParam(req, 'studentId'),
    );
    res.status(204).end();
  };
}
