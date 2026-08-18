import { randomBytes } from 'node:crypto';

/**
 * TD-9 — upload limits, the MIME whitelist, magic-byte verification, and the
 * immutable storage-key structure.
 *
 * **One module for all four**, because they are one decision seen from four
 * sides: a type is accepted only if it is on the whitelist, its cap follows from
 * its class, its magic bytes are what prove the declaration, and its key is what
 * the object is stored under. Splitting them would let the whitelist gain a type
 * the sniffer cannot recognise — a file accepted by declaration alone, which is
 * precisely what §4.9's server-side validation exists to prevent.
 */

/**
 * **Video is deliberately absent.** TD-9's whitelist names audio, documents,
 * slides and images and no video type at all, and §4.9 (Revision 12) states
 * *"Video remains excluded entirely."* Accepting `video/*` here would be an
 * agent widening a normative allow-list, which §20 rule 16 forbids — it is a
 * Document Owner decision and an SRS revision, not an implementation detail.
 * (`kindOf` in the library client still maps `video/*` for *presentation*,
 * because the two lists answer different questions: what may be stored, versus
 * how a stored thing is shown.)
 */
export const AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
] as const;

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export type AcceptedMime = (typeof AUDIO_MIME_TYPES)[number] | (typeof DOCUMENT_MIME_TYPES)[number];

const MB = 1024 * 1024;

/** TD-9: audio 100 MB (Revision 12, reduced from 500 MB), everything else 50 MB. */
export const SIZE_CAPS = {
  audio: 100 * MB,
  document: 50 * MB,
} as const;

/**
 * **The media type without its parameters** — `audio/webm;codecs=opus` is
 * `audio/webm` with a parameter, not a different type (RFC 9110 §8.3).
 *
 * The whitelist compared the whole declared string, which is comparing the
 * wrong thing: it refused **every recording the in-app recorder produces**,
 * because `MediaRecorder` names its codec in the type it hands back and the blob
 * carries that name verbatim. It would equally have refused a stray space or a
 * `charset` a proxy appended.
 *
 * This **widens nothing** (§20 rule 16). No type joins TD-9's list; a
 * parameterised spelling of a type already on it is simply read correctly, and
 * the magic-byte check that turns a declaration into a fact is untouched.
 */
export function mimeEssence(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

export function isAcceptedMime(mime: string): mime is AcceptedMime {
  const essence = mimeEssence(mime);
  return (
    (AUDIO_MIME_TYPES as readonly string[]).includes(essence) ||
    (DOCUMENT_MIME_TYPES as readonly string[]).includes(essence)
  );
}

/** The TD-9 cap that governs this type. */
export function sizeCapFor(mime: AcceptedMime): number {
  return (AUDIO_MIME_TYPES as readonly string[]).includes(mimeEssence(mime))
    ? SIZE_CAPS.audio
    : SIZE_CAPS.document;
}

/* ── Magic bytes ─────────────────────────────────────────────────────────── */

/**
 * Signatures, checked against the **first 512 bytes only** (§4.9, Revision 8).
 *
 * The server never streams or buffers a whole file to validate it — it issues
 * one ranged GET for `bytes=0-511` and decides from that window. Every
 * signature below therefore lives in the first few bytes by construction;
 * a format whose identity is only provable further in cannot be validated this
 * way and does not belong on the whitelist.
 *
 * A predicate rather than a byte-prefix table because three of these are not
 * prefixes: RIFF containers carry their real type at offset 8, MP4 carries
 * `ftyp` at offset 4, and MP3 is either an ID3 tag or a bare frame sync.
 */
type Sniffer = (head: Buffer) => boolean;

const startsWith = (...bytes: number[]): Sniffer =>
  (head) => bytes.every((b, i) => head[i] === b);

const ascii = (offset: number, text: string): Sniffer =>
  (head) => head.subarray(offset, offset + text.length).toString('latin1') === text;

const both = (a: Sniffer, b: Sniffer): Sniffer => (head) => a(head) && b(head);
const either = (a: Sniffer, b: Sniffer): Sniffer => (head) => a(head) || b(head);

/** `50 4B 03 04` — a local file header. The `05 06`/`07 08` variants are an
 *  empty and a spanned archive; neither can be a real office document, so only
 *  the ordinary header is accepted. */
const zip = startsWith(0x50, 0x4b, 0x03, 0x04);

/**
 * MP3 without an ID3 tag: an 11-bit frame sync, `FF Ex` or `FF Fx`.
 *
 * The nibble mask matters — `FF` followed by anything is not a frame sync, and
 * treating it as one would accept an arbitrary file whose first byte happens to
 * be `FF` (a JPEG, for one).
 */
const mp3FrameSync: Sniffer = (head) =>
  head[0] === 0xff && head[1] !== undefined && (head[1] & 0xe0) === 0xe0;

const SIGNATURES: Record<AcceptedMime, Sniffer> = {
  'application/pdf': ascii(0, '%PDF-'),
  'image/jpeg': startsWith(0xff, 0xd8, 0xff),
  'image/png': startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/webp': both(ascii(0, 'RIFF'), ascii(8, 'WEBP')),
  'audio/wav': both(ascii(0, 'RIFF'), ascii(8, 'WAVE')),
  'audio/ogg': ascii(0, 'OggS'),
  // EBML — the container Matroska and WebM share. The document type sits deeper
  // than a header sniff can reach, so a WebM declaration is verified as far as
  // the container and no further; that is the honest limit of a 512-byte window.
  'audio/webm': startsWith(0x1a, 0x45, 0xdf, 0xa3),
  'audio/mp4': ascii(4, 'ftyp'),
  'audio/mpeg': either(ascii(0, 'ID3'), mp3FrameSync),
  // The three OOXML types are ZIP archives and are indistinguishable from one
  // another at this depth. The check is therefore "consistent with the
  // declaration", which is what a magic-byte test can honestly assert.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': zip,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': zip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': zip,
};

/**
 * Do the bytes actually on the object match what the caller declared?
 *
 * §4.9: a mismatch is `409 VALIDATION_FAILED`, the object is deleted, and no
 * `EducationalContent` row is created — a declared MIME type is a claim, and
 * this is the only thing that turns it into a fact.
 */
export function magicBytesMatch(mime: AcceptedMime, head: Buffer): boolean {
  // Keyed by essence for the same reason the whitelist is: the signature belongs
  // to the container, and `audio/webm;codecs=opus` is the same container as
  // `audio/webm`. Without this the lookup returns `undefined` and throws.
  const check = SIGNATURES[mimeEssence(mime) as AcceptedMime];
  return check !== undefined && check(head);
}

/* ── Storage keys (TD-9) ─────────────────────────────────────────────────── */

/**
 * Arabic → Latin transliteration for the key segment.
 *
 * TD-9 asks for the original filename slugified with *"Arabic preserved via
 * transliteration slug + stored display name in DB"*. Dropping non-Latin
 * characters instead would turn every Arabic filename into the same empty slug,
 * so keys would stop carrying any hint of what the object is — the one thing the
 * segment is there for. The true filename is kept verbatim in
 * `original_filename`; this is only what the key reads like.
 */
const ARABIC_TRANSLITERATION: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'a', ء: '', ؤ: 'u', ئ: 'i',
  ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh',
  ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', ة: 'h', و: 'w', ي: 'y', ى: 'a', ﻻ: 'la',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** Latin letters, digits and a single separator — nothing that could be read as
 *  a path segment, a query delimiter or a signing artefact. */
export function slugify(value: string): string {
  const transliterated = [...value]
    .map((ch) => ARABIC_TRANSLITERATION[ch] ?? ch)
    .join('')
    // Decompose so a Latin accent becomes a base letter plus a combining mark,
    // and drop the mark: `é` must slug to `e`, not to a separator. Arabic
    // tashkeel needs no clause of its own — the ASCII filter below removes it.
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');

  const slug = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  // A filename of nothing but characters this map has no letter for still needs
  // a key. `file` is a placeholder, not a guess at the name.
  return slug === '' ? 'file' : slug;
}

/** The extension, lowercased, without the dot. Empty where the name has none —
 *  a key with no extension is valid and preferable to inventing one. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
}

/**
 * `content/{content_id}/{short-random-hash}/{slug}.{ext}` (TD-9).
 *
 * **The hash segment is why re-uploading a file with the same name cannot be
 * masked by a cached copy** of the old one. Keys are immutable once written:
 * replacing a file mints a *new* key with a *new* hash segment and quarantines
 * the old object; nothing is ever overwritten in place (§20 rule 15).
 *
 * **Visibility is never encoded here** — the bucket carries it (§7), which is
 * what lets a visibility change be a bucket migration rather than a key rewrite
 * that would break every URL ever handed out.
 */
export function buildStorageKey(contentId: string, originalFilename: string): string {
  const hash = randomBytes(4).toString('hex');
  const ext = extensionOf(originalFilename);
  const name = slugify(originalFilename.replace(/\.[^.]*$/, ''));
  return `content/${contentId}/${hash}/${name}${ext === '' ? '' : `.${ext}`}`;
}

/** Where a soft-deleted object waits out BR-15's 90-day window (TD-9). */
export function quarantineKeyFor(contentId: string, storageKey: string): string {
  return `quarantine/${contentId}/${storageKey.split('/').slice(2).join('/')}`;
}
