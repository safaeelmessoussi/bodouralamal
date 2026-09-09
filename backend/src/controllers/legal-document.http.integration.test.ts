import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * The versioned Privacy Policy / Terms of Use (R138 §12/§13), over real HTTP.
 *
 * **What only this layer can prove.** `legal-document.integration.test.ts`
 * calls the service functions directly, which can never observe whether the
 * ACTUAL route is wired to the right verb, whether the `kind` path segment is
 * validated the way the controller claims, or whether the public read is
 * genuinely reachable with no bearer at all — every one of those is a fact
 * about the Express router and the zod boundary, not about the service.
 *
 * Requires the compose stack, with the api image built from current source —
 * `bash scripts/ci/test-integration.sh` provides exactly that, disposably.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-legal-doc-test]";

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: unknown[];
  };
}

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> {
  return httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });
}

function bearer(
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string {
  return issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeUser(label: string, role: string): Promise<string> {
  const u = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  // `assertFreshActive` (R60) re-verifies the role against the LIVE row, not
  // merely the JWT claim — the whole reason it exists is to catch a role the
  // token was minted with but no longer has. The bearer below must carry a
  // role scope AND a real assignment must exist, or every write here would
  // pass on a token whose claim nothing backs.
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId: u.id, roleId: roleRow.id, branchId: null } });
  return u.id;
}

let superId = "";
let adminId = "";
let superToken = "";
let adminToken = "";

async function clear(): Promise<void> {
  const rows = await prisma.legalDocument.findMany({
    where: { versionLabel: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.legalDocument.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeEach(async () => {
  await clear();
  superId = await makeUser("مشرفة عامة", "super_admin");
  adminId = await makeUser("مسؤولة", "admin");
  superToken = bearer(superId, [{ role: "super_admin", branches: null }]);
  adminToken = bearer(adminId, [{ role: "admin", branches: null }]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("the real route surface", () => {
  it("a Super Admin drafts, activates, and the public read shows it — with no bearer at all", async () => {
    const created = await call("POST", "/admin/legal-documents", superToken, {
      kind: "privacy_policy",
      version_label: `${TAG} v1`,
      body_arabic: "نص تجريبي (أ) — لا قيمة قانونية له.",
    });
    expect(created.status).toBe(201);
    expect(created.body["status"]).toBe("draft");
    const id = created.body["id"] as string;

    const activated = await call("POST", `/admin/legal-documents/${id}/activate`, superToken);
    expect(activated.status).toBe(200);
    expect(activated.body["status"]).toBe("active");

    // Genuinely anonymous — `token` omitted entirely, not merely a role check.
    const publicRead = await call("GET", "/legal-documents/privacy_policy");
    expect(publicRead.status).toBe(200);
    expect(publicRead.body["id"]).toBe(id);
    expect(publicRead.body["body_arabic"]).toBe("نص تجريبي (أ) — لا قيمة قانونية له.");
    // The public projection never carries status/provenance (dto.ts's own
    // publicLegalDocumentDto contract) — asserted at the wire, not the type.
    expect(publicRead.body["status"]).toBeUndefined();
    expect(publicRead.body["created_by_id"]).toBeUndefined();
  });

  it("an Admin (not Super Admin) is refused every write verb over real HTTP", async () => {
    const create = await call("POST", "/admin/legal-documents", adminToken, {
      kind: "terms_of_use",
      version_label: `${TAG} refused`,
      body_arabic: "نص",
    });
    expect(create.status).toBe(403);
    expect(create.body.error?.code).toBe("FORBIDDEN");

    const list = await call("GET", "/admin/legal-documents/terms_of_use", adminToken);
    expect(list.status).toBe(403);
  });

  it("an unknown kind in the URL is a coded 400, not a 404 or a crash", async () => {
    const res = await call("GET", "/legal-documents/not-a-real-kind");
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("activating a second draft supersedes the first, which stays readable — never deleted", async () => {
    const first = await call("POST", "/admin/legal-documents", superToken, {
      kind: "terms_of_use",
      version_label: `${TAG} v1`,
      body_arabic: "نص (أ)",
    });
    await call("POST", `/admin/legal-documents/${first.body["id"] as string}/activate`, superToken);

    const second = await call("POST", "/admin/legal-documents", superToken, {
      kind: "terms_of_use",
      version_label: `${TAG} v2`,
      body_arabic: "نص (ب)",
    });
    const secondActivated = await call(
      "POST",
      `/admin/legal-documents/${second.body["id"] as string}/activate`,
      superToken,
    );
    expect(secondActivated.status).toBe(200);

    const publicRead = await call("GET", "/legal-documents/terms_of_use");
    expect(publicRead.body["body_arabic"]).toBe("نص (ب)");

    const list = await call("GET", "/admin/legal-documents/terms_of_use", superToken);
    const rows = (list.body.data as { id: string; status: string; body_arabic: string }[]).filter(
      (r) => r.body_arabic === "نص (أ)" || r.body_arabic === "نص (ب)",
    );
    const superseded = rows.find((r) => r.body_arabic === "نص (أ)");
    expect(superseded?.status).toBe("superseded");
    // The historical wording itself — untouched, not summarised, not gone.
    expect(superseded?.body_arabic).toBe("نص (أ)");
  });

  it("editing a version that has ever been active is refused — new wording is a new version", async () => {
    const draft = await call("POST", "/admin/legal-documents", superToken, {
      kind: "privacy_policy",
      version_label: `${TAG} immutable`,
      body_arabic: "نص أصلي",
    });
    const id = draft.body["id"] as string;
    const active = await call("POST", `/admin/legal-documents/${id}/activate`, superToken);

    const edit = await call("PATCH", `/admin/legal-documents/${id}`, superToken, {
      version_label: `${TAG} immutable`,
      body_arabic: "نص معدَّل",
      version: active.body["version"],
    });
    expect(edit.status).toBe(409);
    expect(edit.body.error?.details?.["reason"]).toBe("LEGAL_DOCUMENT_IMMUTABLE");
  });
});
