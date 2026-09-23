import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

import type { PrismaClient } from "../generated/prisma/client.js";
import {
  deleteObject,
  openObjectRead,
  putObjectStream,
  statObjectStrict,
  type StorageClients,
} from "../lib/storage.js";
import { listSegments } from "./session-recording-segments.js";
import { markRecoveredFromSegments } from "./session-recording.service.js";

/**
 * **A recorder that dies mid-class loses nothing recorded** (Document Owner,
 * 2026-09-21 — SRS Revision 168 §2).
 *
 * The recorder holds a class's final file locally and uploads it once, when the
 * class ends; a host reboot or an out-of-memory kill takes that file with it.
 * Since this revision it ALSO uploads the recording in ten-second segments while
 * the class runs (`segmentsPrefixFor`). This module is what happens when the
 * final file never arrives: the segments are joined, in order, into the file the
 * recording always named (`output_key`), and from there the recording is an
 * ordinary `completed` one — verified, imported and swept by the same pipeline
 * as every other (R99.13). Nothing here creates library content.
 *
 * ## How they are joined
 *
 * HLS segments are MPEG-TS, and MPEG-TS is concatenable by bytes. They are
 * streamed from storage straight into `ffmpeg` on stdin — no copy of the inputs
 * ever touches this container's disk — and REMUXED (`-c copy`: nothing is
 * re-encoded, so it costs seconds, not minutes, and loses no quality) into an
 * MP4 whose index is moved to the front (`+faststart`) so it seeks like any
 * other recording. Only the OUTPUT is written to a temporary directory, which is
 * removed whatever happens.
 *
 * ## When it is safe
 *
 * Never while the recorder might still be writing. The caller decides that
 * (`reconcileRecordings`); this module refuses on its own account only where a
 * final file already exists — the recorder's own file always wins.
 *
 * ## What it costs
 *
 * At most the last segment — ten seconds — that the recorder had not finished
 * when it died.
 */

export const FFMPEG_PATH = process.env["FFMPEG_PATH"] ?? "/usr/local/bin/ffmpeg";

/** Joins MPEG-TS bytes arriving on a stream into one MP4 file. Injected so the
 *  flow can be tested where no `ffmpeg` exists; production uses `ffmpegAssemble`. */
export type Assembler = (segments: AsyncIterable<Readable>, outputPath: string) => Promise<void>;

export const ffmpegAssemble: Assembler = async (segments, outputPath) => {
  const child = spawn(
    FFMPEG_PATH,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "mpegts", "-i", "pipe:0",
      // Remux only. `aac_adtstoasc` is what AAC needs to move from TS to MP4.
      "-c", "copy", "-bsf:a", "aac_adtstoasc",
      "-movflags", "+faststart",
      "-f", "mp4", outputPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 4_000) stderr += chunk.toString("utf8");
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  // A dead ffmpeg closes its stdin; the write error is the symptom, the exit
  // code is the cause, so the write error is swallowed and the code reported.
  child.stdin.on("error", () => undefined);

  /**
   * **A backpressured write waits for `drain` OR for the child to be gone**
   * (codex review, 2026-09-22). Waiting on `drain` alone hung for ever once
   * ffmpeg had exited under backpressure — no drain ever comes from a closed
   * pipe — so a failed assembly never became the recorded, retryable failure
   * the reconciler expects. `exited` settles either way; a settled child makes
   * the wait resolve at once and the exit code below say what happened.
   */
  const drainedOrGone = () =>
    new Promise<void>((resolve) => {
      const onDrain = () => {
        child.stdin.off("close", onDrain);
        resolve();
      };
      child.stdin.once("drain", onDrain);
      child.stdin.once("close", onDrain);
      void exited.then(onDrain, onDrain);
    });

  try {
    for await (const segment of segments) {
      for await (const chunk of segment) {
        if (child.exitCode !== null || child.stdin.destroyed) break;
        if (!child.stdin.write(chunk)) await drainedOrGone();
      }
      if (child.exitCode !== null || child.stdin.destroyed) break;
    }
  } finally {
    child.stdin.end();
  }
  const code = await exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${String(code)}: ${stderr.trim().slice(0, 500)}`);
};

/** The assembly's own key, beside the recorder's — never the recorder's. */
export function recoveredKeyFor(key: string): string {
  return `${key}.recovered.mp4`;
}

export type RecoveryOutcome =
  | { recovered: true; segments: number; sizeBytes: number }
  | { recovered: false; reason: "no_segments" | "final_file_exists" | "not_recoverable" };

/**
 * Assembles a recording's safety segments into its final file and hands it to
 * the ordinary pipeline. Idempotent: a second call finds the final file and
 * stops. Throws when assembly itself fails — the caller retries next time, and
 * the segments are still there because nothing here deletes them.
 */
export async function recoverFromSegments(
  prisma: PrismaClient,
  clients: StorageClients,
  recordingId: string,
  assemble: Assembler = ffmpegAssemble,
): Promise<RecoveryOutcome> {
  const recording = await prisma.sessionRecording.findFirst({
    where: { id: recordingId, deletedAt: null, educationalContentId: null },
    select: { status: true, outputBucket: true, outputKey: true, mimeType: true },
  });
  if (!recording?.outputBucket || !recording.outputKey || !recording.mimeType) {
    return { recovered: false, reason: "not_recoverable" };
  }
  const { outputBucket: bucket, outputKey: key, mimeType } = recording;

  const inventory = await listSegments(clients, bucket, key);
  if (inventory.keys.length === 0) return { recovered: false, reason: "no_segments" };

  // A file is already there: the recorder's own after all, or ours from an
  // attempt that died between the upload and recording the fact. It always wins
  // — it is never rebuilt — and a recording still marked failed is told so.
  const existing = await statObjectStrict(clients, bucket, key);
  if (existing !== null) {
    if (recording.status === "completed") return { recovered: false, reason: "final_file_exists" };
    await markRecoveredFromSegments(prisma, recordingId, {
      sizeBytes: existing.sizeBytes,
      segments: inventory.keys.length,
      stoppedAt: inventory.newestAt,
    });
    return { recovered: true, segments: inventory.keys.length, sizeBytes: existing.sizeBytes };
  }

  const workdir = await mkdtemp(join(tmpdir(), "bodour-recover-"));
  const assembled = join(workdir, "recording.mp4");
  try {
    async function* bodies(): AsyncIterable<Readable> {
      for (const segmentKey of inventory.keys) {
        yield (await openObjectRead(clients, bucket, segmentKey)).body;
      }
    }
    await assemble(bodies(), assembled);

    const { size } = await stat(assembled);
    if (size === 0) throw new Error("the assembled recording is empty");
    /**
     * **Written to a key of its own, never the recorder's** (codex review,
     * 2026-09-22). The PUT used to target `key`: a recorder that finished its
     * complete file between the `stat` above and this write was overwritten
     * by a shorter assembly, and «the recorder's file always wins» was a
     * comment, not a rule. Now the assembly lands beside the recorder's key;
     * the row is repointed to it under the row's own transition guard, and a
     * recorder completion that arrives later repoints it back
     * (`applyProviderReport`) — the recorder's file wins by construction.
     */
    const recoveredKey = recoveredKeyFor(key);
    await putObjectStream(clients, { bucket, key: recoveredKey }, createReadStream(assembled), {
      contentLength: size,
      contentType: mimeType,
    });

    const adopted = await markRecoveredFromSegments(prisma, recordingId, {
      sizeBytes: size,
      segments: inventory.keys.length,
      stoppedAt: inventory.newestAt,
      recoveredKey,
    });
    if (!adopted) {
      // The recorder completed in the meantime: its file stands, ours goes.
      await deleteObject(clients, bucket, recoveredKey).catch(() => undefined);
      return { recovered: false, reason: "final_file_exists" };
    }
    return { recovered: true, segments: inventory.keys.length, sizeBytes: size };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
