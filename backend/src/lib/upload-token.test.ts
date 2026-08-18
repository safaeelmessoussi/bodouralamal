import { describe, expect, it } from "vitest";

import { issueOnboardingToken } from "./onboarding-token.js";
import {
  issueUploadTicket,
  UPLOAD_TICKET_TTL_SECONDS,
  verifyUploadTicket,
} from "./upload-token.js";

/**
 * The upload ticket (TD-3.5).
 *
 * It stands in for a table, so what has to hold is that it cannot be *edited*:
 * every authorization decision taken at `/initiate` is inside it, and a client
 * that could change one would have made the first check decorative.
 */
const KEY = "test-signing-key";

const claims = {
  sub: "user-1",
  cid: "content-1",
  bucket: "private",
  key: "content/content-1/abcd1234/notes.pdf",
  filename: "notes.pdf",
  mime: "application/pdf",
  size: 1024,
  level_id: "level-1",
  subject_id: "subject-1",
  academic_year_id: "year-1",
  branch_id: "branch-1",
  visibility: "private",
};

describe("the upload ticket", () => {
  it("round-trips every bound claim", () => {
    const { token } = issueUploadTicket(claims, KEY);
    const verified = verifyUploadTicket(token, KEY);
    expect(verified.valid).toBe(true);
    if (!verified.valid) return;
    expect(verified.claims).toMatchObject(claims);
  });

  it("refuses a payload edited to widen the scope", () => {
    // The attack the binding exists to stop: initiate inside your own branch,
    // then complete into the Global scope (§4.9) by rewriting the ticket.
    const { token } = issueUploadTicket(claims, KEY);
    const [, signature] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...claims, branch_id: null, exp: 2 ** 31 }),
    ).toString("base64url");
    const result = verifyUploadTicket(`${tampered}.${signature}`, KEY);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("bad_signature");
  });

  it("refuses a ticket signed with a different key", () => {
    const { token } = issueUploadTicket(claims, KEY);
    expect(verifyUploadTicket(token, "another-key").valid).toBe(false);
  });

  it("is NOT interchangeable with an onboarding token", () => {
    // TD-13 keeps token classes separate. The ticket key is derived from
    // JWT_SIGNING_KEY under its own HKDF label precisely so that a signature
    // from one class can never satisfy the other.
    const { token } = issueOnboardingToken(
      { email: "a@example.com", providerSubjectId: "sub" },
      KEY,
    );
    expect(verifyUploadTicket(token, KEY).valid).toBe(false);
  });

  it("expires, and says so distinctly from a forgery", () => {
    // The client's remedy differs: an expired ticket means restart the upload,
    // a bad signature means something is wrong that retrying will not fix.
    const { token } = issueUploadTicket(claims, KEY, new Date(0));
    const later = new Date((UPLOAD_TICKET_TTL_SECONDS + 1) * 1000);
    const result = verifyUploadTicket(token, KEY, later);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("expired");
  });

  it("refuses a validly-signed payload that is missing a field", () => {
    // A signature over a half-payload would otherwise surface as `undefined`
    // inside a storage key, deep in the completion transaction.
    const { token: full } = issueUploadTicket(claims, KEY);
    void full;
    const partial = issueUploadTicket(
      { ...claims, key: undefined as unknown as string },
      KEY,
    ).token;
    expect(verifyUploadTicket(partial, KEY).valid).toBe(false);
  });

  it("refuses a malformed token rather than throwing", () => {
    // `timingSafeEqual` throws on a length mismatch; a thrown error here would
    // be a 500 where a tampered ticket must be a refusal.
    expect(verifyUploadTicket("not-a-token", KEY)).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(verifyUploadTicket("abc.def", KEY).valid).toBe(false);
  });
});
