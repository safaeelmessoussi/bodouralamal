import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from '../test-support/consumed-tokens.js';
import { httpCall } from "../test-support/http-client.js";
import {
  deleteTestConsentText,
  installTestConsentText,
  removeTestConsentText,
  type InstalledConsentText,
} from '../test-support/legal-consent-text.js';

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

let consentText: InstalledConsentText | null = null;
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
const adultPerson = (first: string, last: string) => ({
  ...person(first, last),
  phone: '+212600000020',
});

const adult = () => ({
  kind: "adult" as const,
  applicant: adultPerson("خديجة", "بنعلي"),
  branch_id: branchId,
  category_id: categoryId,
  consents: { data_processing: true, consent_text_id: consentText!.id },
});

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
  });
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
  await clear();
  // R119 — the wording this suite records against, and it says in Arabic
  // that it is development text with no legal value.
  // **Installed ONCE**, not per test: a second install would take the
  // suite's own row as *what was there before* and lose the installation's,
  // leaving it superseded after the run (P1.2).
  consentText ??= await installTestConsentText(prisma, "http-reg-v1");
  branchId = (await prisma.branch.create({ data: { name: `${TAG} مقر` } })).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } }))
    .id;
});

afterAll(async () => {
  // **Restored FIRST, not last** (B10): the restore used to sit after the
  // fixture teardown, so any failure there skipped it and left this suite's
  // scratch wording in the shared database. See `test-support/legal-consent-text`.
  await removeTestConsentText(prisma, consentText);
  await clear();
  // Restore, never delete — deleting is what left the developer's database
  // unable to accept a registration at all.
  // **Last, after the fixture teardown**: `consent_text_id` is RESTRICT, so a
  // row is only free to go once this suite's own consent records have gone.
  await deleteTestConsentText(prisma, consentText);
  await prisma.$disconnect();
});

/**
 * **Runs `run` with NO legal wording in force**, then puts back what was.
 *
 * R119 — the state used to be *the `SystemSetting` row is absent*; it is now
 * *no `LegalConsentText` has `status = 'active'`*. Nothing is deleted: the
 * suite's own version is stamped `superseded` and stamped back, so a wording
 * another suite or the developer installed survives untouched.
 *
 * `finally`, and that is the point of this helper existing at all: a failing
 * assertion inside `run` must not leave the shared development database with no
 * active wording, which is exactly the shape that took registration down for
 * everybody once already.
 */
async function withNoActiveConsentText<T>(run: () => Promise<T>): Promise<T> {
  const active = await prisma.legalConsentText.findFirst({
    where: { status: "active" },
    select: { id: true },
  });
  if (active) {
    await prisma.legalConsentText.update({
      where: { id: active.id },
      data: { status: "superseded", supersededAt: new Date() },
    });
  }
  try {
    return await run();
  } finally {
    if (active) {
      await prisma.legalConsentText.update({
        where: { id: active.id },
        data: { status: "active", supersededAt: null },
      });
    }
  }
}

describe("the missing legal consent wording is ACTIONABLE, not a generic outage", () => {
  it("answers 503 with a coded reason rather than a bare outage", async () => {
    // The P0, from the browser's side. A bare `SERVICE_UNAVAILABLE` sent the
    // form's author looking at the network and the operator at the logs, when
    // the cause was that nobody had put a legal wording in force.
    //
    // **R119 removed `setting` from the details.** It named
    // `legal.consent_text_version`, which after the cutover is neither the
    // authority nor the remedy; the coded `reason` is what a client branches on
    // and is unchanged, which is why the message it maps to still works.
    const res = await withNoActiveConsentText(() => submit(adult(), freshToken()));

    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.body.error?.details).toMatchObject({
      reason: "CONSENT_TEXT_VERSION_NOT_CONFIGURED",
    });
    // §14.4 wants it shown discreetly beside the error, so it has to be there.
    expect(res.body.error?.request_id).toBeTruthy();
  });

  it("persists NOTHING when it refuses", async () => {
    await withNoActiveConsentText(() => submit(adult(), freshToken()));
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(0);
  });

  /**
   * **R119 — the wording changed while the form was open.**
   *
   * The race the whole `consent_text_id` round trip exists for: a Super Admin
   * activates a new version between the form being drawn and being submitted.
   * Recording the NEW version would state that this person agreed to words they
   * never saw, so the server refuses and the client re-presents.
   */
  it("refuses a submission naming a version that is no longer in force", async () => {
    const superseded = consentText!.id;
    const replacement = await installTestConsentText(
      prisma,
      "http-reg-superseding-v1",
    );
    try {
      const res = await submit(adult(), freshToken());
      expect(res.status).toBe(409);
      expect(res.body.error?.details).toMatchObject({
        reason: "CONSENT_TEXT_SUPERSEDED",
      });
      // Nothing was written against either version.
      expect(
        await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
      ).toBe(0);
      expect(superseded).not.toBe(replacement.id);
    } finally {
      // Restore, then remove: the replacement is this test's own row and
      // nothing references it, so it must not survive the run (P1.2).
      await removeTestConsentText(prisma, replacement);
      await deleteTestConsentText(prisma, replacement);
    }
  });
});

describe("a well-formed submission succeeds end to end", () => {
  it("creates a pending applicant and returns the §4.1b shape", async () => {
    const res = await submit(adult(), freshToken());

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
    const res = await submit(
        {
          kind: "parent_child",
          parent: adultPerson("أمينة", "بنعلي"),
          children: [
            {
              ...person("سارة", "بنعلي"),
              consent_media_release: false,
              requested_branch_id: branchId,
              requested_category_id: categoryId,
            },
          ],
          consents: { data_processing: true, consent_text_id: consentText!.id },
        },
        freshToken(),
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

  it.each([1, 2, 3])(
    "accepts the browser consent shape for %i child(ren) and stores one applicant consent",
    async (childCount) => {
      const children = Array.from({ length: childCount }, (_, index) => ({
        ...person(`طفلة ${index + 1}`, "بنعلي"),
        consent_media_release: index % 2 === 0,
        requested_branch_id: branchId,
        requested_category_id: categoryId,
      }));

      const res = await submit(
        {
          kind: "parent_child",
          parent: adultPerson("أمينة", "بنعلي"),
          children,
          // This is exactly the frontend payload: data processing belongs to
          // the request; media release belongs to every child.
          consents: { data_processing: true, consent_text_id: consentText!.id },
        },
        freshToken(),
      );

      expect(res.status).toBe(201);
      expect(res.body.child_application_ids).toHaveLength(childCount);
      expect(
        await prisma.childApplication.count({
          where: { id: { in: res.body.child_application_ids ?? [] } },
        }),
      ).toBe(childCount);
      expect(
        await prisma.consentRecord.count({
          where: { studentId: res.body.applicant_id!, consentType: "data_processing" },
        }),
      ).toBe(1);
    },
  );
});

describe("the boundary refuses what it should, over HTTP", () => {
  it("R117 refuses a new registration without a contact phone", async () => {
    const body = adult();
    const { phone: _phone, ...withoutPhone } = body.applicant;
    const res = await submit({ ...body, applicant: withoutPhone }, freshToken());
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a client-supplied name_arabic rather than ignoring it", async () => {
    // §1.1 / R40: the server composes the name. Accepting one from the client
    // would make the client the authority on how a person's name reads.
    const res = await submit(
        {
          kind: "adult",
          applicant: { ...adultPerson("خديجة", "بنعلي"), name_arabic: "شيء آخر" },
          branch_id: branchId,
          category_id: categoryId,
          consents: { data_processing: true, consent_text_id: consentText!.id },
        },
        freshToken(),
      );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses an identity field in the body (§20 rule 9)", async () => {
    const res = await submit(
        {
          ...adult(),
          applicant: {
            ...person("خديجة", "بنعلي"),
            email: "someone@else.test",
          },
        },
        freshToken(),
      );
    expect(res.status).toBe(400);
  });

  it("refuses a missing onboarding token", async () => {
    const res = await submit(adult());
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a refused data-processing consent with CONSENT_REQUIRED", async () => {
    // **The wording is still named** (R119): a refusal is a decision about a
    // specific text, and dropping the id here would make this assert the schema
    // rather than the consent rule.
    const res = await submit(
      {
        ...adult(),
        consents: { data_processing: false, consent_text_id: consentText!.id },
      },
      freshToken(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("CONSENT_REQUIRED");
  });

  /**
   * **R119 — the version presented is REQUIRED, and the server does not fill
   * it in.**
   *
   * Defaulting to *whatever is active* is the obvious convenience, and it is
   * exactly the race the parameter exists to close: it would record agreement
   * to whichever wording happened to be in force at submission rather than the
   * one the person read.
   */
  it("refuses a submission that names no wording at all", async () => {
    // The count is deliberately NOT asserted here: this describe block does not
    // clear between tests, so a global count would be measuring the suite's own
    // earlier successes. *Persists nothing on refusal* is asserted where the
    // fixture supports it, above.
    const body = adult();
    const res = await submit(
      { ...body, consents: { data_processing: true } } as never,
      freshToken(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });
});
