import { EventEmitter } from "node:events";

import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accessLog, errorHandler, requestContext } from "./request-context.js";

afterEach(() => vi.restoreAllMocks());

const next = vi.fn() as unknown as NextFunction;

describe("TD-14 request correlation contains no caller-supplied PII", () => {
  it("accepts Nginx/UUID correlation ids and replaces arbitrary public values", () => {
    const unsafe = "person@example.test";
    const req = {
      header: vi.fn().mockReturnValue(unsafe),
    } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;

    requestContext(req, res, next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{32,36}$/i);
    expect(req.requestId).not.toContain(unsafe);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);

    const nginxId = "0123456789abcdef0123456789abcdef";
    const trusted = {
      header: vi.fn().mockReturnValue(nginxId),
    } as unknown as Request;
    requestContext(trusted, res, next);
    expect(trusted.requestId).toBe(nginxId);

    const uuid = "8f44ed80-c070-4f9e-8df6-194a03c8b945";
    const local = {
      header: vi.fn().mockReturnValue(uuid),
    } as unknown as Request;
    requestContext(local, res, next);
    expect(local.requestId).toBe(uuid);
  });

  it("logs the registered route template and never an unmatched raw path", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as typeof process.stdout.write);
    const response = Object.assign(new EventEmitter(), { statusCode: 404 });
    const req = {
      requestId: "0123456789abcdef0123456789abcdef",
      method: "GET",
      path: "/person@example.test",
    } as unknown as Request;

    accessLog(req, response as unknown as Response, next);
    response.emit("finish");
    const unmatched = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(unmatched["path"]).toBe("<unmatched>");
    expect(JSON.stringify(unmatched)).not.toContain("person@example.test");

    write.mockClear();
    const matchedResponse = Object.assign(new EventEmitter(), { statusCode: 200 });
    const matched = {
      ...req,
      route: { path: "/admin/users/:id" },
      path: "/admin/users/person@example.test",
    } as unknown as Request;
    accessLog(matched, matchedResponse as unknown as Response, next);
    matchedResponse.emit("finish");
    const logged = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(logged["path"]).toBe("/admin/users/:id");
    expect(JSON.stringify(logged)).not.toContain("person@example.test");
  });

  it("does not copy raw exception messages into the operator log", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as typeof process.stderr.write);
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const req = {
      requestId: "0123456789abcdef0123456789abcdef",
    } as unknown as Request;

    errorHandler(new Error("database failed for person@example.test"), req, res, next);

    const logged = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(logged["message"]).toBe("unhandled application error");
    expect(JSON.stringify(logged)).not.toContain("person@example.test");
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
