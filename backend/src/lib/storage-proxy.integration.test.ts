import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import {
  BUCKETS,
  createStorageClients,
  presignGetUrl,
  presignPutUrl,
  type StorageClients,
} from "./storage.js";

/**
 * §18 MANDATORY ACCEPTANCE TEST — "signed PUT + signed GET round-trip through
 * the /storage proxy passes".
 *
 * §3.1 is explicit that this must never be "verified" by direct-to-MinIO
 * access: the whole point is that the SigV4 signature survives Nginx's prefix
 * strip and Host rewrite. Every request below therefore goes to
 * STORAGE_BASE_URL (the public origin), never to MINIO_ENDPOINT.
 *
 * Requires the compose stack (nginx + minio) to be up:
 *   docker compose up -d minio minio-init nginx
 *   npm run test:integration
 */
const config = loadConfig();
let clients: StorageClients;

async function proxyReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.STORAGE_BASE_URL}/${BUCKETS.public}/`, {
      method: "GET",
      redirect: "manual",
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  clients = createStorageClients(config);
  if (!(await proxyReachable())) {
    throw new Error(
      `Storage proxy unreachable at ${config.STORAGE_BASE_URL}. ` +
        "Start the stack first: docker compose up -d minio minio-init nginx",
    );
  }
});

describe("signed PUT + signed GET round-trip through the Nginx /storage proxy (§3.1, §18)", () => {
  it("round-trips a private-bucket object without SignatureDoesNotMatch", async () => {
    const key = `test/roundtrip-${randomBytes(6).toString("hex")}.bin`;
    const payload = randomBytes(2048);

    const putUrl = await presignPutUrl(clients, BUCKETS.private, key);
    // The browser-facing URL must be rooted at the public storage origin.
    expect(putUrl.startsWith(config.STORAGE_BASE_URL)).toBe(true);
    expect(putUrl).not.toContain(config.MINIO_ENDPOINT);

    const putRes = await fetch(putUrl, { method: "PUT", body: payload });
    // Read the body once: consuming it inside an assertion message would burn
    // the stream even when the assertion passes.
    const putBody = putRes.ok ? "" : await putRes.text();
    expect(
      putRes.ok,
      `presigned PUT through the proxy failed: ${putRes.status} ${putBody}`,
    ).toBe(true);

    const getUrl = await presignGetUrl(clients, BUCKETS.private, key);
    const getRes = await fetch(getUrl);
    expect(
      getRes.ok,
      `presigned GET through the proxy failed: ${getRes.status}`,
    ).toBe(true);

    const roundTripped = Buffer.from(await getRes.arrayBuffer());
    expect(roundTripped.equals(payload)).toBe(true);
  });

  it("serves the private bucket ONLY through a signature — never a stable URL (§20 rule 4)", async () => {
    const key = `test/unsigned-${randomBytes(6).toString("hex")}.bin`;
    const payload = randomBytes(256);

    const putUrl = await presignPutUrl(clients, BUCKETS.private, key);
    expect((await fetch(putUrl, { method: "PUT", body: payload })).ok).toBe(
      true,
    );

    // Same path, no query signature: the object must not be readable. Nginx
    // maps MinIO's 403 to the friendly /content-unavailable redirect (§3.1),
    // so the assertion is "not a 2xx that returns the bytes".
    const unsigned = await fetch(
      `${config.STORAGE_BASE_URL}/${BUCKETS.private}/${key}`,
      {
        redirect: "manual",
      },
    );
    expect(unsigned.ok).toBe(false);
  });

  it("maps a stale/missing public link to /content-unavailable, never raw S3 XML (§3.1)", async () => {
    const res = await fetch(
      `${config.STORAGE_BASE_URL}/${BUCKETS.public}/does-not-exist.bin`,
      {
        redirect: "manual",
      },
    );
    expect(res.status).toBe(302);
    // Assert the resolved path, not the raw header: `return 302` builds an
    // absolute URL from the request's own $scheme/host, so the literal value
    // differs between the HTTP and TLS server blocks while the destination is
    // identical.
    const location = res.headers.get("location") ?? "";
    expect(new URL(location, config.STORAGE_BASE_URL).pathname).toBe(
      "/content-unavailable",
    );
    expect((await res.text()).toLowerCase()).not.toContain("<error>");
  });

  it("answers a rejected upload with a real error, not the friendly-page redirect", async () => {
    // Regression guard: the §3.1 error-page mapping is for users following
    // stale links (GET navigations). If it also caught writes, a rejected
    // presigned PUT would return 302, the client would follow it, and the
    // uploader would see a bogus status instead of a retryable failure
    // (§14.3 FileUploader, §14.4 offline/retry state, R-9).
    const badSignature =
      `${config.STORAGE_BASE_URL}/${BUCKETS.private}/regression.bin` +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef";

    const res = await fetch(badSignature, {
      method: "PUT",
      body: "x",
      redirect: "manual",
    });
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(302);
  });

  it("rejects an expired signature (TD-12 short-lived URLs)", async () => {
    const key = `test/expiry-${randomBytes(6).toString("hex")}.bin`;
    const putUrl = await presignPutUrl(clients, BUCKETS.private, key);
    expect(
      (await fetch(putUrl, { method: "PUT", body: randomBytes(64) })).ok,
    ).toBe(true);

    // Already outside its validity window when minted.
    const expiredUrl = await presignGetUrl(clients, BUCKETS.private, key, -60);
    const res = await fetch(expiredUrl, { redirect: "manual" });
    expect(res.ok).toBe(false);
  });
});
