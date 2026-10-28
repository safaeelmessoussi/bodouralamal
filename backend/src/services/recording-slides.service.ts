import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { loadWritableContent } from './content.service.js';

/**
 * **R247 — a recording's slides** (the Owner, 2026-10-28: «an audio can be
 * related to parts of slide of the مطبوع … to be listening and seeing the
 * slides concerning what is being listened to»).
 *
 * The images are ordinary library items; this only says which of them are the
 * pages of which recording, in which order. Writing it is editing the
 * recording AND each image, so both go through the edit rule
 * (`loadWritableContent`: staff, the item's branch in scope — the Owner: the
 * same people who may upload it). A session's slides are its attached images,
 * linked through `POST /sessions/{id}/content` as before.
 */

export interface RecordingSlideRef {
  id: string;
  title: string;
  position: number;
}

/** At most this many pages per recording — a whole «مطبوع» fits well within it. */
export const MAX_SLIDES = 200;

async function loadRecording(prisma: PrismaClient, actor: Actor, recordingId: string): Promise<void> {
  const recording = await loadWritableContent(prisma, actor, recordingId);
  if (!recording.mimeType.startsWith('audio/')) {
    throw new AppError('VALIDATION_FAILED', 'only a recording has slides', { reason: 'NOT_A_RECORDING' });
  }
}

/** `GET /content/{id}/slides` — the recording's pages, in order. */
export async function listRecordingSlides(
  prisma: PrismaClient,
  actor: Actor,
  recordingId: string,
): Promise<RecordingSlideRef[]> {
  await loadRecording(prisma, actor, recordingId);
  const rows = await prisma.recordingSlide.findMany({
    where: { recordingId, slide: { deletedAt: null } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { position: true, slide: { select: { id: true, title: true } } },
  });
  return rows.map((row) => ({ id: row.slide.id, title: row.slide.title, position: row.position }));
}

/**
 * `PUT /content/{id}/slides` — the WHOLE ordered list, replacing what was
 * there (R76's reorder rule: a sequence, never a patch of positions). An image
 * that was a page of another recording moves here: it is a page of one.
 */
export async function setRecordingSlides(
  prisma: PrismaClient,
  actor: Actor,
  recordingId: string,
  slideIds: readonly string[],
): Promise<RecordingSlideRef[]> {
  if (new Set(slideIds).size !== slideIds.length) {
    throw new AppError('VALIDATION_FAILED', 'a slide is listed twice', { reason: 'DUPLICATE_SLIDE' });
  }
  if (slideIds.includes(recordingId)) {
    throw new AppError('VALIDATION_FAILED', 'a recording is not its own slide', { reason: 'NOT_AN_IMAGE' });
  }
  await loadRecording(prisma, actor, recordingId);
  for (const slideId of slideIds) {
    const slide = await loadWritableContent(prisma, actor, slideId);
    if (!slide.mimeType.startsWith('image/')) {
      throw new AppError('VALIDATION_FAILED', 'a slide is an image', { reason: 'NOT_AN_IMAGE' });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.recordingSlide.deleteMany({
      where: { OR: [{ recordingId }, ...(slideIds.length > 0 ? [{ slideId: { in: [...slideIds] } }] : [])] },
    });
    if (slideIds.length > 0) {
      await tx.recordingSlide.createMany({
        data: slideIds.map((slideId, position) => ({ slideId, recordingId, position, createdById: actor.userId })),
      });
    }
  });
  return listRecordingSlides(prisma, actor, recordingId);
}
