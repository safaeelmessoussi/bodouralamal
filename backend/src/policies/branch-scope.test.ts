import { describe, expect, it } from "vitest";

import {
  branchFilter,
  branchesForRole,
  canActOnBranch,
  hasRole,
  isSuperAdmin,
  rolesOf,
  toRoleScopes,
  type RoleScope,
} from "./branch-scope.js";

/**
 * §4.2 Revision 24 — branch-scoped authorization.
 *
 * Two rules here were real defects before this module existed, so each has a
 * test that fails if the old behaviour returns: an all-branches assignment
 * reaching nothing, and scope flattening across roles.
 */
const row = (role: string, branchId: string | null) => ({
  branchId,
  role: { name: role },
});

const MARRAKESH = "b-marrakesh";
const CASABLANCA = "b-casa";

describe("toRoleScopes", () => {
  it("collapses several rows of one role into one entry", () => {
    const scopes = toRoleScopes([
      row("admin", MARRAKESH),
      row("admin", CASABLANCA),
    ]);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]!.role).toBe("admin");
    expect([...scopes[0]!.branches!].sort()).toEqual(
      [CASABLANCA, MARRAKESH].sort(),
    );
  });

  it('a NULL branch means ALL branches, not "no scope"', () => {
    // The defect this replaces: an all-branches Admin resolved to an empty list
    // and could therefore see zero branches.
    expect(toRoleScopes([row("admin", null)])).toEqual([
      { role: "admin", branches: null },
    ]);
  });

  it("an all-branches grant DOMINATES a specific grant of the same role", () => {
    // Holding both must not narrow the wider grant.
    const scopes = toRoleScopes([row("admin", MARRAKESH), row("admin", null)]);
    expect(scopes).toEqual([{ role: "admin", branches: null }]);
  });

  it("keeps roles separate rather than merging their branches", () => {
    const scopes = toRoleScopes([
      row("teacher", CASABLANCA),
      row("admin", MARRAKESH),
    ]);
    expect(scopes).toHaveLength(2);
    expect(branchesForRole(scopes, "admin")).toEqual([MARRAKESH]);
    expect(branchesForRole(scopes, "teacher")).toEqual([CASABLANCA]);
  });

  it("rolesOf derives the role list", () => {
    const scopes = toRoleScopes([
      row("teacher", CASABLANCA),
      row("admin", null),
    ]);
    expect(rolesOf(scopes).sort()).toEqual(["admin", "teacher"]);
    expect(hasRole(scopes, "admin")).toBe(true);
    expect(hasRole(scopes, "parent")).toBe(false);
  });
});

describe("canActOnBranch — per-role, never a union", () => {
  const dualRole: RoleScope[] = [
    { role: "teacher", branches: [CASABLANCA] },
    { role: "admin", branches: [MARRAKESH] },
  ];

  it("THE defect: a Teacher in Casablanca who is Admin in Marrakesh cannot administer Casablanca", () => {
    expect(canActOnBranch(dualRole, "admin", MARRAKESH)).toBe(true);
    // A flat union would have said true here, silently extending admin authority
    // to a branch the person only teaches in.
    expect(canActOnBranch(dualRole, "admin", CASABLANCA)).toBe(false);
  });

  it("an all-branches assignment authorizes any branch", () => {
    const allBranches: RoleScope[] = [{ role: "admin", branches: null }];
    expect(canActOnBranch(allBranches, "admin", MARRAKESH)).toBe(true);
    expect(canActOnBranch(allBranches, "admin", "b-anything")).toBe(true);
  });

  it("a role the caller does not hold authorizes nothing", () => {
    // Reaching "no restrictions" out of a missing role would be the worst
    // possible default, so an absent role resolves to an empty reach.
    expect(branchesForRole(dualRole, "parent")).toEqual([]);
    expect(canActOnBranch(dualRole, "parent", MARRAKESH)).toBe(false);
  });

  it("Super Admin bypasses branch restrictions by ROLE, not by a null scope", () => {
    // §2.1/§4.2: the bypass is a property of the role. Note the scope here is an
    // explicitly narrow one, and it is still bypassed.
    const superAdmin: RoleScope[] = [
      { role: "super_admin", branches: [MARRAKESH] },
    ];
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(canActOnBranch(superAdmin, "super_admin", CASABLANCA)).toBe(true);
    expect(branchesForRole(superAdmin, "anything")).toBeNull();
  });
});

describe("branchFilter", () => {
  it("is unrestricted for Super Admin", () => {
    expect(
      branchFilter([{ role: "super_admin", branches: [MARRAKESH] }], ["admin"]),
    ).toEqual({});
  });

  it("is unrestricted for an all-branches assignment", () => {
    expect(
      branchFilter([{ role: "admin", branches: null }], ["admin"]),
    ).toEqual({});
  });

  it("restricts to the named role's branches only", () => {
    const scopes: RoleScope[] = [
      { role: "teacher", branches: [CASABLANCA] },
      { role: "admin", branches: [MARRAKESH] },
    ];
    expect(branchFilter(scopes, ["admin"])).toEqual({
      id: { in: [MARRAKESH] },
    });
  });

  it("matches nothing when the role is not held", () => {
    expect(
      branchFilter([{ role: "teacher", branches: [CASABLANCA] }], ["admin"]),
    ).toEqual({
      id: { in: [] },
    });
  });
});
