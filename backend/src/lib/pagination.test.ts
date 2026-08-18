import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  page,
  pageParamsFrom,
  pageWindow,
} from "./pagination.js";

/**
 * TD-10's pagination rule — *"default 25, max 100"*.
 *
 * The rule previously existed as two byte-identical copies in two services,
 * while five other list endpoints implemented none of it. These tests exist so
 * the constants have one home that fails loudly if it moves.
 */
describe("TD-10 — the page window", () => {
  it("defaults to page 1 × 25", () => {
    expect(pageWindow()).toEqual({ skip: 0, take: 25, page: 1, pageSize: 25 });
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });

  it("caps the page size at 100 rather than refusing the request", () => {
    // A client asking for 5,000 rows is asking for something TD-10 does not
    // offer; refusing would turn a cosmetic client bug into an outage.
    expect(pageWindow({ pageSize: 5000 }).take).toBe(MAX_PAGE_SIZE);
    expect(MAX_PAGE_SIZE).toBe(100);
    // And it reports back what it actually applied, so the client is not misled.
    expect(pageWindow({ pageSize: 5000 }).pageSize).toBe(100);
  });

  it("floors nonsensical input instead of producing a negative offset", () => {
    // A negative skip is a database error, not a smaller page.
    expect(pageWindow({ page: 0 }).skip).toBe(0);
    expect(pageWindow({ page: -5 }).skip).toBe(0);
    expect(pageWindow({ pageSize: 0 }).take).toBe(1);
    expect(pageWindow({ pageSize: -9 }).take).toBe(1);
  });

  it("computes the offset from page and size", () => {
    expect(pageWindow({ page: 3, pageSize: 10 })).toMatchObject({
      skip: 20,
      take: 10,
    });
  });

  it("truncates a fractional page rather than passing it to the database", () => {
    expect(pageWindow({ page: 2.7, pageSize: 10 }).skip).toBe(10);
  });
});

describe("TD-10 — the response envelope", () => {
  it("reports the window actually applied alongside the unpaginated total", () => {
    const result = page(["a", "b"], pageWindow({ page: 2, pageSize: 2 }), 57);

    expect(result).toEqual({
      data: ["a", "b"],
      meta: { page: 2, page_size: 2, total: 57 },
    });
    // `total` is the whole result set, not the page — a client cannot compute
    // "how many pages" without it.
    expect(result.meta.total).not.toBe(result.data.length);
  });
});

describe("TD-10 — reading the query string", () => {
  it("reads ?page and ?page_size", () => {
    expect(pageParamsFrom({ page: "3", page_size: "50" })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it("treats absent or malformed values as unset, so defaults apply", () => {
    // `?page=abc` is a malformed client, not a reason to fail a read.
    expect(pageParamsFrom({})).toEqual({
      page: undefined,
      pageSize: undefined,
    });
    expect(pageParamsFrom({ page: "abc" }).page).toBeUndefined();
    expect(pageWindow(pageParamsFrom({ page: "abc" })).page).toBe(1);
  });
});
