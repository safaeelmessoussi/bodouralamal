/**
 * **Cut each «مطبوع» into one image per page** (the Owner, 2026-11-03 — R263).
 *
 * Lists every live PDF that names a Surah and is titled «مطبوع…», with the
 * pages it already has. `APPLY=1 PDF_IDS=<id>,<id>` cuts the PDFs named
 * (`cutPrintPages`); a PDF that already has pages is refused, so a second run
 * adds nothing.
 *
 *   docker compose exec -T api npm run --silent ops:cut-print-pages </dev/null
 *
 * **Lists only, by default.** (A dry run that needs a flag is the one that gets
 * forgotten — `ops:empty-trash`, 2026-10.)
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import { createStorageClients } from '../lib/storage.js';
import { cutPrintPages, listPrintCandidates } from '../services/print-pages.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 2);
const clients = createStorageClients(config);
const apply = process.env['APPLY'] === '1';
const chosen = (process.env['PDF_IDS'] ?? '').split(',').map((id) => id.trim()).filter(Boolean);

const owner = await prisma.platformOwner.findFirst({ select: { ownerUserId: true } });
if (!owner) throw new Error('no platform owner: nobody to act as');

for (const candidate of await listPrintCandidates(prisma)) {
  console.log(`${candidate.id}  ${String(candidate.pages).padStart(3)} page(s)  ${candidate.title}`);
}

if (apply) {
  if (chosen.length === 0) throw new Error('APPLY=1 needs PDF_IDS');
  for (const id of chosen) {
    const made = await cutPrintPages(prisma, clients, id, owner.ownerUserId);
    console.log(`cut ${id}: ${String(made)} page(s)`);
  }
}

await prisma.$disconnect();
