import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import type { StorageClients } from '../lib/storage.js';
import { ACTIVE_CHILD_HEADER } from '../middleware/child-context.js';
import { requireActor } from '../middleware/authenticate.js';
import * as content from '../services/content.service.js';
import { completeUploadSchema, initiateUploadSchema } from '../validators/content.validators.js';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { idParam, parse } from './parse.js';

/**
 * Storage (TD-3.5) — the two-phase upload and the permission-checked mint.
 *
 * **The upload id is the ticket itself** (`lib/upload-token.ts`), so
 * `/uploads/{upload_id}/complete` reads exactly as TD-3.5 writes it while the
 * server keeps no pending-upload row §7 never defined.
 *
 * `GET /content/{id}/download-url` deliberately does **not** mount the
 * `childContext` middleware: staff reach content through a different
 * authorization path (§4.3) and would be asked for a header they have no reason
 * to send. The service calls the same resolver directly, for the parent-only
 * callers the rule is actually about.
 */

export function initiate(prisma: PrismaClient, clients: StorageClients, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(initiateUploadSchema, req.body);
    const result = await content.initiateUpload(
      prisma,
      clients,
      config.JWT_SIGNING_KEY,
      requireActor(req),
      {
        filename: body.filename,
        size: body.size,
        mime: body.mime,
        meta: {
          levelId: body.content_meta.level_id,
          subjectId: body.content_meta.subject_id,
          academicYearId: body.content_meta.academic_year_id,
          branchId: body.content_meta.branch_id,
          ...(body.content_meta.visibility ? { visibility: body.content_meta.visibility } : {}),
          ...(body.content_meta.origin ? { origin: body.content_meta.origin } : {}),
          ...(body.content_meta.replaces_content_id
            ? { replacesContentId: body.content_meta.replaces_content_id }
            : {}),
        },
      },
    );
    res.status(201).json({
      upload_id: result.uploadId,
      key: result.key,
      put_url: result.putUrl,
      expires_in: result.expiresIn,
    });
  };
}

export function complete(prisma: PrismaClient, clients: StorageClients, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse(completeUploadSchema, req.body);
    const result = await content.completeUpload(
      prisma,
      clients,
      config.JWT_SIGNING_KEY,
      requireActor(req),
      String(req.params['uploadId'] ?? ''),
      { title: body.title, description: body.description ?? null },
    );
    res.status(201).json({ id: result.id });
  };
}

/**
 * `PATCH /content/{id}` — **what the item IS, never the file it holds.**
 *
 * `.strict()`, so a client that tried to send a filename, a size or a storage
 * key here is refused rather than quietly ignored: this route cannot replace an
 * object, and a request that appears to have done so must not receive a 200.
 * Replacement remains TD-9's own path.
 */
const updateContentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    level_id: z.uuid().optional(),
    subject_id: z.uuid().optional(),
    visibility: z.enum(['public', 'private', 'hidden']).optional(),
  })
  .strict();

export function update(prisma: PrismaClient, clients: StorageClients) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = parse<Record<string, unknown>>(updateContentSchema, req.body) as {
      title?: string;
      level_id?: string;
      subject_id?: string;
      visibility?: 'public' | 'private' | 'hidden';
    };
    // An empty patch is a request that asks for nothing; answering 204 would
    // report a change that did not happen.
    if (Object.keys(body).length === 0) {
      throw new AppError('VALIDATION_FAILED', 'at least one field must be given', {
        reason: 'EMPTY_PATCH',
      });
    }
    await content.updateContentMetadata(
      prisma,
      clients,
      requireActor(req),
      String(req.params['id'] ?? ''),
      {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.level_id !== undefined ? { levelId: body.level_id } : {}),
        ...(body.subject_id !== undefined ? { subjectId: body.subject_id } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      },
    );
    res.status(204).end();
  };
}

export function abort(prisma: PrismaClient, clients: StorageClients, config: AppConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    await content.abortUpload(
      prisma,
      clients,
      config.JWT_SIGNING_KEY,
      requireActor(req),
      String(req.params['uploadId'] ?? ''),
    );
    res.status(204).end();
  };
}

export function remove(prisma: PrismaClient, clients: StorageClients) {
  return async (req: Request, res: Response): Promise<void> => {
    await content.deleteContent(prisma, clients, requireActor(req), idParam(req, 'id'));
    res.status(204).end();
  };
}

export function downloadUrl(prisma: PrismaClient, clients: StorageClients) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await content.mintDownloadUrl(
      prisma,
      clients,
      requireActor(req),
      idParam(req, 'id'),
      req.header(ACTIVE_CHILD_HEADER) ?? undefined,
    );
    // A minted URL is never cacheable: it is short-lived by design (TD-12) and
    // shared caching would hand one caller's grant to another.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ url: result.url, expires_in: result.expiresIn });
  };
}
