/**
 * **R263 — a «مطبوع», one image per page** (the Owner, 2026-11-03: «get the
 * available مطبوع of a surah, split it to images, each image contain a page of
 * the مطبوع, with titles such as: صفحة 6 مطبوع تفسير سورة الفاتحة»).
 *
 * Each page becomes an ordinary library image filed exactly as its PDF is
 * (Level and its other Levels, Subject, year, branches, Surah and part,
 * visibility, author), titled «صفحة N» + the PDF's title, and marked
 * `print_page_of` = the PDF. A reader is shown it only once it is attached to
 * a recording as one of its «صفحات المطبوع» (R247); until then it waits in
 * «مكتبة المحتوى». The PDF itself is unchanged.
 *
 * Rendered on the server (`pdftoppm`, poppler-utils in the API image), so the
 * file never leaves the platform's storage (§19.0).
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { PrismaClient } from '../generated/prisma/client.js';
import { buildStorageKey, storageCoordinateId } from '../lib/file-types.js';
import { openObjectRead, putObjectStream, type StorageClients } from '../lib/storage.js';
import * as audit from '../repositories/audit.repository.js';

const run = promisify(execFile);

/** Wide enough to read a handout's small print on a phone, small enough to load fast. */
const PAGE_DPI = 150;

/** «صفحة 6 مطبوع تفسير سورة الفاتحة»: the page number, then the PDF's own title. */
export function printPageTitle(page: number, pdfTitle: string): string {
  return `صفحة ${String(page)} ${pdfTitle.trim()}`.slice(0, 200);
}

export interface PrintCandidate {
  id: string;
  title: string;
  pages: number;
}

/** Every live PDF that names a Surah and is titled «مطبوع…», with how many pages it already has. */
export async function listPrintCandidates(prisma: PrismaClient): Promise<PrintCandidate[]> {
  const rows = await prisma.educationalContent.findMany({
    where: { deletedAt: null, mimeType: 'application/pdf', surahId: { not: null }, title: { startsWith: 'مطبوع' } },
    select: { id: true, title: true, _count: { select: { printPages: { where: { deletedAt: null } } } } },
    orderBy: { surahId: 'asc' },
  });
  return rows.map((row) => ({ id: row.id, title: row.title, pages: row._count.printPages }));
}

/**
 * Cuts one PDF into page images. Refuses a PDF that already has pages, so a
 * second run adds nothing. Returns how many pages were made.
 */
export async function cutPrintPages(
  prisma: PrismaClient,
  clients: StorageClients,
  pdfId: string,
  actorUserId: string,
): Promise<number> {
  const pdf = await prisma.educationalContent.findFirst({
    where: { id: pdfId, deletedAt: null, mimeType: 'application/pdf' },
    include: {
      additionalLevels: { select: { levelId: true } },
      additionalBranches: { select: { branchId: true } },
      _count: { select: { printPages: { where: { deletedAt: null } } } },
    },
  });
  if (!pdf) throw new Error(`no live PDF ${pdfId}`);
  if (pdf._count.printPages > 0) throw new Error(`${pdfId} already has ${String(pdf._count.printPages)} page(s)`);

  const work = await mkdtemp(join(tmpdir(), 'print-pages-'));
  try {
    const source = join(work, 'source.pdf');
    const { body } = await openObjectRead(clients, pdf.storageBucket, pdf.storageKey);
    await writeFile(source, body);
    await run('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-r', String(PAGE_DPI), source, join(work, 'page')]);
    // pdftoppm pads the number to the page count's width: page-01.jpg … page-17.jpg.
    const files = (await readdir(work))
      .filter((name) => /^page-\d+\.jpg$/.test(name))
      .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));

    for (const [index, file] of files.entries()) {
      const page = index + 1;
      const id = randomUUID();
      const filename = `page-${String(page)}.jpg`;
      const key = buildStorageKey(id, filename);
      const path = join(work, file);
      const size = (await stat(path)).size;
      await putObjectStream(clients, { bucket: pdf.storageBucket, key }, createReadStream(path), {
        contentLength: size,
        contentType: 'image/jpeg',
      });
      await prisma.$transaction(async (tx) => {
        await tx.educationalContent.create({
          data: {
            id,
            title: printPageTitle(page, pdf.title),
            description: null,
            visibility: pdf.visibility,
            consentForcedPrivate: pdf.consentForcedPrivate,
            mediaConsentMissing: pdf.mediaConsentMissing,
            levelId: pdf.levelId,
            wholeCategory: pdf.wholeCategory,
            subjectId: pdf.subjectId,
            academicYearId: pdf.academicYearId,
            branchId: pdf.branchId,
            surahId: pdf.surahId,
            surahPart: pdf.surahPart,
            authorId: pdf.authorId,
            authorRole: pdf.authorRole,
            printPageOfId: pdf.id,
            storageBucket: pdf.storageBucket,
            storageKey: key,
            originalFilename: filename,
            mimeType: 'image/jpeg',
            sizeBytes: BigInt(size),
            origin: 'uploaded',
            createdById: actorUserId,
            ...(pdf.additionalLevels.length > 0
              ? { additionalLevels: { create: pdf.additionalLevels.map(({ levelId }) => ({ levelId })) } }
              : {}),
            ...(pdf.additionalBranches.length > 0
              ? { additionalBranches: { create: pdf.additionalBranches.map(({ branchId }) => ({ branchId })) } }
              : {}),
          },
        });
        await audit.write(tx, {
          actorUserId,
          activeRole: 'super_admin',
          actionType: 'content.upload',
          targetEntity: 'EducationalContent',
          targetId: id,
          detail: {
            mime: 'image/jpeg',
            size_bytes: size,
            visibility: pdf.visibility,
            print_page_of: pdf.id,
            page,
            canonical_coordinate_id: storageCoordinateId(pdf.storageBucket, key),
            source: 'ops:cut-print-pages',
          },
        });
      });
    }
    return files.length;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
