import { describe, expect, it } from 'vitest';

import SCHEDULING from './scheduling.tsx?raw';
import ADAPTER from '../../adapters/scheduling.ts?raw';

/**
 * **An online exam's `at_start`/`offset_minutes` availability was silently
 * unusable for every target kind** (Owner-reported, 2026-09-14).
 *
 * The server (`exam-scheduling.service.ts`) anchors `at_start`/
 * `offset_minutes` on the request's own `start_time` — no target kind
 * derives a time of day server-side, `session` included — and refuses
 * `AVAILABILITY_NEEDS_START_TIME` without it. The online branch of
 * `saveSchedulingItem` (`adapters/scheduling.ts`) built its `scheduleExam()`
 * call without `start_time`/`end_time` at all, even though the shared form
 * already collects and defaults them (09:00–10:00) for every exam, physical
 * or online — so the value existed on screen and was simply never sent.
 *
 * Asserted against source, matching this directory's established precedent:
 * the property is wiring (does the online payload builder forward a value
 * the physical one already sends identically), which a render test cannot
 * see without a live session and a real scheduling request.
 */
const pageSource = SCHEDULING.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('scheduling an online exam sends the start time its own availability needs', () => {
  it('the online scheduleExam() call forwards start_time/end_time, same as the physical branch', () => {
    // ADAPTER (not the comment-stripped adapterSource): the fix's own marker
    // comment anchors the match to the online branch specifically — a plain
    // `toContain` against the whole file would also match the PHYSICAL
    // branch's identical-looking lines on the unfixed source.
    const marker = ADAPTER.indexOf('dropped before this fix');
    const startTimeLine = ADAPTER.indexOf("start_time: input.startTime ?? ''", marker);
    const endTimeLine = ADAPTER.indexOf("end_time: input.endTime ?? ''", marker);
    expect(marker).toBeGreaterThan(-1);
    expect(startTimeLine).toBeGreaterThan(marker);
    expect(endTimeLine).toBeGreaterThan(startTimeLine);
    expect(endTimeLine - startTimeLine).toBeLessThan(80);
  });

  it('the request-shape comment no longer claims start_time/end_time are physical-only', () => {
    // The stale comment ("Physical only.") is the documented root cause of
    // the omission above ever having shipped in the first place.
    expect(ADAPTER).not.toMatch(/Physical only\.\s*\*\/\s*\n\s*start_time/);
  });

  it("refuses client-side, naming the field, when at_start/offset_minutes has no start time", () => {
    expect(pageSource).toMatch(
      /availabilityChoice === 'at_start' \|\|\s*\n\s*examSource\.availabilityChoice === 'offset_minutes'\)\s*&&\s*\n\s*startTime === ''/,
    );
  });
});
