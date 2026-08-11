import { describe, expect, it } from 'vitest';

import { allocateReferenceCode, generateReferenceCode } from './reference-code.js';

/**
 * R62.5 — the properties that make a reference code safe to say out loud.
 */
describe('the code is shaped for the ear and the hand', () => {
  it('omits every character that is misread when spoken or copied', () => {
    // 0/O and 1/I/L are the pairs that produce a wrong child, not a failed
    // lookup — which is the failure worth designing against.
    const codes = Array.from({ length: 400 }, generateReferenceCode);
    for (const code of codes) {
      expect(code, code).not.toMatch(/[0O1IL]/);
      expect(code).toMatch(/^BA-[2-9A-Z]{5}$/);
    }
  });
});

describe('random, never sequential (R62.5)', () => {
  it('does not produce a predictable series', () => {
    // A sequence would leak enrolment order and headcount, and given one code
    // anybody could try its neighbour.
    const codes = Array.from({ length: 200 }, generateReferenceCode);
    expect(new Set(codes).size).toBeGreaterThan(190);

    // Deliberately weak assertion, deliberately: this proves the values are not
    // a counter. Proving randomness is a statistics exercise, and the property
    // that actually protects the platform is "holding a code grants nothing".
    const bodies = codes.map((c) => c.slice(3));
    expect(new Set(bodies.map((b) => b[0])).size).toBeGreaterThan(5);
  });
});

describe('allocation retries rather than failing a registration', () => {
  it('draws again when a code is already taken', async () => {
    let calls = 0;
    const code = await allocateReferenceCode(async () => {
      calls += 1;
      return calls < 3; // the first two are taken
    });
    expect(calls).toBe(3);
    expect(code).toMatch(/^BA-/);
  });

  it('fails loudly rather than looping when every draw collides', async () => {
    // Five collisions in a 28-million space is a broken generator, not luck.
    await expect(allocateReferenceCode(async () => true, 5)).rejects.toThrow(
      /could not allocate/,
    );
  });
});
