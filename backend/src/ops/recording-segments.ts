/**
 * `npm run ops:recording-segments -- <recording-id>` — **what a recording has
 * in staging right now** (SRS Revision 168 §2). Read-only.
 *
 * `{ status, final_file, segments, newest_segment_at, recovered_from_segments }`
 * — enough to answer, for a class whose recorder died, *is it recoverable* and
 * *when did the recorder last show a sign of life*, without listing a bucket by
 * hand. Under `src/` so that it ships in the release image.
 */
import { loadConfig } from '../lib/config.js';
import { createOnlineClassProvider } from '../lib/online-class-provider.js';
import { createPrismaClient } from '../lib/prisma.js';
import { createStorageClients, listObjectsPage, statObjectStrict } from '../lib/storage.js';
import { listSegments } from '../services/session-recording-segments.js';

const recordingId = process.argv[2];
if (!recordingId) {
  process.stderr.write('usage: npm run ops:recording-segments -- <recording-id>\n');
  process.exit(2);
}
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 2);
const clients = createStorageClients(config);
const row = await prisma.sessionRecording.findUnique({
  where: { id: recordingId },
  select: {
    status: true,
    outputBucket: true,
    outputKey: true,
    recoveredFromSegments: true,
    providerEgressId: true,
  },
});
// What the PROVIDER says about the job, asked now — beside what storage holds,
// because the two can disagree (a killed recorder is still «active» to it).
const provider = createOnlineClassProvider(config);
const providerState =
  provider === null || !row?.providerEgressId
    ? null
    : await provider
        .reportRecording(row.providerEgressId)
        .then((report) => report?.state ?? 'unknown')
        .catch(() => 'unreachable');
if (!row?.outputBucket || !row.outputKey) {
  process.stdout.write(`${JSON.stringify({ found: row !== null, status: row?.status ?? null, output: false })}\n`);
} else {
  const inventory = await listSegments(clients, row.outputBucket, row.outputKey);
  // Everything the recorder has left for this recording's OCCURRENCE, bounded —
  // what an operator needs when the segments are not where they were expected.
  const folder = row.outputKey.slice(0, row.outputKey.lastIndexOf('/') + 1);
  const nearby = await listObjectsPage(clients, row.outputBucket, folder, { maxKeys: 50 });
  process.stdout.write(
    `${JSON.stringify({
      status: row.status,
      provider_state: providerState,
      final_file: (await statObjectStrict(clients, row.outputBucket, row.outputKey)) !== null,
      segments: inventory.keys.length,
      newest_segment_at: inventory.newestAt?.toISOString() ?? null,
      recovered_from_segments: row.recoveredFromSegments,
      output_key: row.outputKey,
      nearby_keys: nearby.objects.map((object) => object.key.slice(folder.length)),
    })}\n`,
  );
}
await prisma.$disconnect();
