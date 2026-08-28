import { describe, expect, it } from "vitest";

import { storageCoordinateId } from "./file-types.js";

describe("durable storage-coordinate identity", () => {
  it("identifies an exact coordinate without retaining its filename", () => {
    const key = "content/id/hash/person@example.test.pdf";
    const first = storageCoordinateId("private", key);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("person");
    expect(storageCoordinateId("private", key)).toBe(first);
    expect(storageCoordinateId("public", key)).not.toBe(first);
    expect(storageCoordinateId("private", `${key}.other`)).not.toBe(first);
  });
});
