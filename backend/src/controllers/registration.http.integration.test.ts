import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from '../test-support/consumed-tokens.js';
import { httpCall } from "../test-support/http-client.js";
import {
  captureConsentVersion,
  restoreConsentVersion,
  type SavedConsentVersion,
} from "../test-support/consent-setting.js";
import { CONSENT_TEXT_VERSION_KEY } from "../services/registration.service.js";

/**
 * `POST /registrations` over real HTTP (§4.1b step 5, TD-3.2).
 *
 * **Why this file exists.** There was no HTTP-level test for registration at
 * all, and a P0 got through because of it: submitting the form returned *"try
 * again later"* while the server was refusing for a specific, fixable reason —
 * `legal.consent_text_version` had never been written. The service suite *did*
 * assert that registration fails closed without it, but asserted only the
 * failure, never that the failure told anyone what to do. Nothing tested what
 * the browser actually receives.
 *
 * So this suite asserts the **envelope**, not just the status: the TD-3.8 body
 * is the only thing a client can act on, and a 503 with an empty `details` is
 * indistinguishable from a transient outage.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const suiteTokens = ownedOnboardingTokens();
const issueOnboardingToken = suiteTokens.issue;
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-reg-test]";

let savedConsentVersion: SavedConsentVersion | null = null;
let branchId = "";
/** Revision 49 — the applicant's educational stage travels with every
 *  registration, so the fixture provides one. */
let categoryId = "";

interface Res {
  status: number;
  body: {
    error?: {
      code?: string;
      details?: Record<string, unknown>;
      request_id?: string;
    };
    applicant_id?: string;
    child_application_ids?: string[];
    account_status?: string;
  };
}

let counter = 0;
function freshToken(): string {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  return issueOnboardingToken(
    {
      email: `httpreg-${stamp}@example.com`,
      providerSubjectId: `httpregsub-${stamp}`,
    },
    config.ONBOARDING_TOKEN_KEY,
  ).token;
}

async function submit(body: unknown, token?: string): Promise<Res> {
  return httpCall<Res["body"]>(BASE, "POST", "/registrations", {
    body,
    ...(token === undefined
      ? {}
      : { headers: { "X-Onboarding-Token": token } }),
  });
}

const person = (first: string, last: string) => ({
  first_name_arabic: `${TAG} ${first}`,
  last_name_arabic: last,
  sex: "female" as const,
});

const adult = () => ({
  kind: "adult" as const,
  applicant: person("خديجة", "بنعلي"),
  branch_id: branchId,
  category_id: categoryId,
  consents: { data_processing: true },
});

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  // R62 — a parent_child registration now writes `child_application` rows,
  // which reference the parent under RESTRICT.
  await prisma.childApplication.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { childUserId: { in: ids } }] },
  });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearOwnedConsumedTokens(prisma, suiteTokens);
  await prisma.normalizedEmailLock.deleteMany({ where: { email: { startsWith: "httpreg-" } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  // After the users too: `intended_category_id` is ON DELETE RESTRICT, for the
  // same reason the branch is — a Category with requests pointing at it must not
  // vanish underneath them (R49).
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable — run: docker compose up -d --build api`,
    );
  }
  savedConsentVersion = await captureConsentVersion(prisma);
  await clear();
  branchId = (await prisma.branch.create({ data: { name: `${TAG} مقر` } })).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } }))
    .id;
});

afterAll(async () => {
  await clear();
  // Restore, never delete — deleting is what left the developer's database
  // unable to accept a registration at all.
  if (savedConsentVersion)
    await restoreConsentVersion(prisma, savedConsentVersion);
  await prisma.$disconnect();
});

async function withConsentVersion<T>(
  value: string | null,
  run: () => Promise<T>,
): Promise<T> {
  if (value === null) {
    await prisma.systemSetting.deleteMany({
      where: { key: CONSENT_TEXT_VERSION_KEY },
    });
  } else {
    await prisma.systemSetting.upsert({
      where: { key: CONSENT_TEXT_VERSION_KEY },
      update: { value },
      create: { key: CONSENT_TEXT_VERSION_KEY, value },
    });
  }
  return run();
}

describe("the missing consent text version is ACTIONABLE, not a generic outage", () => {
  it("answers 503 with details naming the exact setting", async () => {
    // The P0, from the browser's side. A bare `SERVICE_UNAVAILABLE` sent the
    // form's author looking at the network and the operator at the logs, when
    // the cause was one unwritten configuration row.
    const res = await withConsentVersion(null, () =>
      submit(adult(), freshToken()),
    );

    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.body.error?.details).toMatchObject({
      reason: "CONSENT_TEXT_VERSION_NOT_CONFIGURED",
      setting: CONSENT_TEXT_VERSION_KEY,
    });
    // §14.4 wants it shown discreetly beside the error, so it has to be there.
    expect(res.body.error?.request_id).toBeTruthy();
  });

  it("persists NOTHING when it refuses", async () => {
    await withConsentVersion(null, () => submit(adult(), freshToken()));
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(0);
  });
});

describe("a well-formed submission succeeds end to end", () => {
  it("creates a pending applicant and returns the §4.1b shape", async () => {
    const res = await withConsentVersion("http-reg-v1", () =>
      submit(adult(), freshToken()),
    );

    expect(res.status).toBe(201);
    expect(res.body.account_status).toBe("pending");
    // R62 — an adult registration names no children; the field is present and
    // empty rather than absent, so a client never has to distinguish the two.
    expect(res.body.child_application_ids).toEqual([]);
    expect(Object.keys(res.body).sort()).toEqual([
      "account_status",
      "applicant_id",
      "child_application_ids",
    ]);
  });

  it("§7 R40: stores both name parts and composes name_arabic server-side", async () => {
    const res = await withConsentVersion("http-reg-v1", () =>
      submit(
        {
          kind: "parent_child",
          parent: person("أمينة", "بنعلي"),
          children: [
            {
              ...person("سارة", "بنعلي"),
              consent_media_release: false,
              requested_branch_id: branchId,
              requested_category_id: categoryId,
            },
          ],
          consents: { data_processing: true, media_release: false },
        },
        freshToken(),
      ),
    );
    expect(res.status).toBe(201);

    const parent = await prisma.user.findUnique({
      where: { id: res.body.applicant_id! },
    });
    expect(parent?.firstNameArabic).toBe(`${TAG} أمينة`);
    expect(parent?.lastNameArabic).toBe("بنعلي");
    expect(parent?.nameArabic).toBe(`${TAG} أمينة بنعلي`);

    // The child too — a composition applied to only the applicant would leave
    // half a family with a broken display name.
    // R62 — no child `User` exists until approval, so the composition this
    // test is about is asserted on the application that will produce it.
    const application = await prisma.childApplication.findUnique({
      where: { id: res.body.child_application_ids![0]! },
    });
    const child = {
      firstNameArabic: application?.firstNameArabic,
      lastNameArabic: application?.lastNameArabic,
      nameArabic: `${application?.firstNameArabic} ${application?.lastNameArabic}`,
    };
    expect(child?.nameArabic).toBe(`${TAG} سارة بنعلي`);
  });
});

describe("the boundary refuses what it should, over HTTP", () => {
  it("refuses a client-supplied name_arabic rather than ignoring it", async () => {
    // §1.1 / R40: the server composes the name. Accepting one from the client
    // would make the client the authority on how a person's name reads.
    const res = await withConsentVersion("http-reg-v1", () =>
      submit(
        {
          kind: "adult",
          applicant: { ...person("خديجة", "بنعلي"), name_arabic: "شيء آخر" },
          branch_id: branchId,
          category_id: categoryId,
          consents: { data_processing: true },
        },
        freshToken(),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses an identity field in the body (§20 rule 9)", async () => {
    const res = await withConsentVersion("http-reg-v1", () =>
      submit(
        {
          ...adult(),
          applicant: {
            ...person("خديجة", "بنعلي"),
            email: "someone@else.test",
          },
        },
        freshToken(),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("refuses a missing onboarding token", async () => {
    const res = await withConsentVersion("http-reg-v1", () => submit(adult()));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a refused data-processing consent with CONSENT_REQUIRED", async () => {
    const res = await withConsentVersion("http-reg-v1", () =>
      submit(
        { ...adult(), consents: { data_processing: false } },
        freshToken(),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("CONSENT_REQUIRED");
  });
});
