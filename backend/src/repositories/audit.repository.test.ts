import { describe, expect, it, vi } from "vitest";

import type { Db } from "./audit.repository.js";
import { write } from "./audit.repository.js";

function database() {
  const create = vi.fn().mockResolvedValue({});
  return {
    db: { auditLog: { create } } as unknown as Db,
    create,
  };
}

describe("TD-14 durable audit-detail minimisation", () => {
  it.each([
    ["email", { identity: { email: "person@example.test" } }],
    ["display name", { public_display_name: "أم فلانة" }],
    ["title", { title: "person@example.test" }],
    ["filename", { original_filename: "person@example.test.pdf" }],
    ["storage key", { storage_key: "content/id/hash/person-example-test.pdf" }],
    ["camel-case display name", { displayName: "person@example.test" }],
    ["camel-case canonical key", { nested: [{ canonicalKey: "content/id/hash/file.pdf" }] }],
    ["alternate old storage key", { nested: { oldStorageKey: "content/id/hash/file.pdf" } }],
  ])("refuses copied %s values before the domain transaction can commit", async (_label, detail) => {
    const { db, create } = database();

    await expect(
      write(db, {
        actorUserId: null,
        actionType: "test.audit",
        targetEntity: "Fixture",
        targetId: "00000000-0000-0000-0000-000000000001",
        detail,
      }),
    ).rejects.toThrow("must use an entity/coordinate id");
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts ids, field names and non-reversible storage coordinate ids", async () => {
    const { db, create } = database();

    await write(db, {
      actorUserId: "00000000-0000-0000-0000-000000000001",
      activeRole: "admin",
      actionType: "test.audit",
      targetEntity: "Fixture",
      targetId: "00000000-0000-0000-0000-000000000002",
      detail: {
        branch_id: "00000000-0000-0000-0000-000000000003",
        fields: ["name", "phone"],
        storage_coordinate_id: "a".repeat(64),
      },
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { detail: { active_role: "admin" } },
    });
  });

  it("does not invent a policy for mandated free-text evidence", async () => {
    const { db, create } = database();

    await write(db, {
      actorUserId: null,
      actionType: "test.audit",
      detail: {
        reason: "person@example.test asked for follow-up",
        note: "owner policy remains required",
        previous_value: "consent-v1",
        new_value: "consent-v2",
      },
    });

    expect(create).toHaveBeenCalledOnce();
  });
});
