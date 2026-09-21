import { describe, expect, it } from 'vitest';

import { segmentsPrefixFor, stagingKeyFor } from './online-class.js';

/**
 * SRS Revision 168 §2 — where a recording's final file and its safety segments
 * live. Found by the recorder-kill drill: asked for `<id>.m4a`, the recorder
 * wrote `<id>.m4a.mp4` and reported that name back, and a prefix computed as
 * «the key minus one extension» then looked in a folder nothing had written to —
 * so the segments that would have saved the class were never found.
 */
describe('a recording’s staging keys', () => {
  const session = '2ba96eee-06d7-4126-9bf6-7aa4bf7249ae';
  const recording = 'd61c8680-cff9-468b-9d17-122501b440a0';

  it('is `.mp4` for both kinds of class — the container’s extension, which the recorder does not rename', () => {
    expect(stagingKeyFor(session, recording, 'audio_only')).toBe(
      `session-recordings/${session}/${recording}.mp4`,
    );
    expect(stagingKeyFor(session, recording, 'audio_video')).toBe(
      `session-recordings/${session}/${recording}.mp4`,
    );
  });

  it('finds the segments from the recording’s ID, whatever the final file ended up being called', () => {
    const folder = `session-recordings/${session}/${recording}.segments/`;
    expect(segmentsPrefixFor(`session-recordings/${session}/${recording}.mp4`)).toBe(folder);
    // What the recorder really reported back for an `.m4a` target.
    expect(segmentsPrefixFor(`session-recordings/${session}/${recording}.m4a.mp4`)).toBe(folder);
    expect(segmentsPrefixFor(`session-recordings/${session}/${recording}`)).toBe(folder);
  });

  it('never reaches outside the recording’s own folder', () => {
    const prefix = segmentsPrefixFor(`session-recordings/${session}/${recording}.mp4`);
    expect(prefix.startsWith(`session-recordings/${session}/${recording}.`)).toBe(true);
    expect(prefix.endsWith('/')).toBe(true);
  });
});
