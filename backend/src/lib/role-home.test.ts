import { describe, expect, it } from "vitest";

import { postLoginDestination } from "./role-home.js";

/**
 * The post-login redirect (§4.1b step 4a, §14.1).
 *
 * **The regression this pins:** the callback redirected every active account to
 * a literal `/dashboard`, a node §14.1 does not define, so signing in as a
 * Super Admin landed on Not Found. The header button had already been fixed to
 * resolve a role home; the *server* redirect had not, which is how the same
 * defect survived in a second place.
 */

describe("postLoginDestination", () => {
  it("NEVER returns the bare /dashboard that produced Not Found", () => {
    for (const roles of [
      ["super_admin"],
      ["admin"],
      ["teacher"],
      ["parent"],
      ["student"],
      [],
    ]) {
      expect(postLoginDestination(roles)).not.toBe("/dashboard");
    }
  });

  it("sends staff to the back office", () => {
    expect(postLoginDestination(["super_admin"])).toBe("/admin");
    expect(postLoginDestination(["admin"])).toBe("/admin");
  });

  it("sends every other role to its §14.1 home", () => {
    expect(postLoginDestination(["teacher"])).toBe("/teacher");
    expect(postLoginDestination(["parent"])).toBe("/dashboard/parent");
    expect(postLoginDestination(["student"])).toBe("/dashboard/student");
  });

  it("resolves the most privileged role, because the redirect is one URL", () => {
    expect(postLoginDestination(["parent", "teacher"])).toBe("/teacher");
    expect(postLoginDestination(["student", "admin"])).toBe("/admin");
  });

  it("lands a role-less account on a real page, never a 404", () => {
    // §14.4's no-role case is reachable only through staff error. The landing
    // page offers a way onward; a Not Found does not.
    expect(postLoginDestination([])).toBe("/");
    expect(postLoginDestination(["nonsense"])).toBe("/");
  });

  it("agrees with the client mirror — both derive from §14.1", () => {
    // Kept as an explicit list rather than an import: the two packages do not
    // share code, so the guarantee is that this table matches
    // `frontend/src/lib/role-home.ts`, and a change to §14.1 updates both.
    expect({
      super_admin: postLoginDestination(["super_admin"]),
      admin: postLoginDestination(["admin"]),
      teacher: postLoginDestination(["teacher"]),
      parent: postLoginDestination(["parent"]),
      student: postLoginDestination(["student"]),
    }).toEqual({
      super_admin: "/admin",
      admin: "/admin",
      teacher: "/teacher",
      parent: "/dashboard/parent",
      student: "/dashboard/student",
    });
  });
});
