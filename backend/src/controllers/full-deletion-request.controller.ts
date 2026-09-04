import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import {
  approveFullDeletion,
  listPendingFullDeletions,
  rejectFullDeletion,
  requestFullDeletion,
} from '../services/full-deletion-request.service.js';
import { idParam, parse } from './parse.js';

/**
 * **Option B — the request/review control plane** (SRS §4.10a, Revision 131).
 *
 * The request half is authenticated and open to any account, because the
 * *entitlement* is decided from live rows in the service — a person asking about
 * herself, or an adult holding a live approved link to a minor — and never from
 * anything the client sends. The decision half is **Super Admin only**, asserted
 * in the service against live rows (TD-12).
 *
 * **No route here deletes anything.** Approval records a decision; execution is
 * a separate, unimplemented step.
 */

const requestSchema = z.object({ subject_id: z.uuid() }).strict();
/** TD-9: a decision's reason is 1–500 characters, as on every other refusal. */
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export function create(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(requestSchema, req.body ?? {});
    const row = await requestFullDeletion(prisma, requireActor(req), body.subject_id);
    res.status(201).json({
      id: row.id,
      status: row.status,
      // Said on the wire, not only in the interface: approving this request does
      // not by itself delete anything, and no promise is made about backups.
      executed: false,
    });
  };
}

export function listPending(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const rows = await listPendingFullDeletions(prisma, requireActor(req));
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        subject_id: row.subjectId,
        subject_name: row.subjectName,
        basis: row.basis,
        requested_by: row.requestedById,
        created_at: row.createdAt.toISOString(),
      })),
    });
  };
}

export function approve(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    await approveFullDeletion(prisma, requireActor(req), idParam(req, 'id'));
    // `executed: false` is the contract's own statement that the decision is
    // recorded and the deletion has not happened.
    res.json({ approved: true, executed: false });
  };
}

export function reject(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(rejectSchema, req.body ?? {});
    await rejectFullDeletion(prisma, requireActor(req), idParam(req, 'id'), body.reason);
    res.status(204).end();
  };
}
