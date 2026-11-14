import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createRequestLogger,
  withLogContext,
} from "../../../packages/game-engine/src/logging.ts";
import {
  readJsonRequest,
  readQueryRequest,
} from "../../../packages/game-engine/src/request.ts";

/**
 * What a bad request looks like from outside: a 400 that names the field, so a
 * caller can tell which one to fix, and a log line that says the same.
 */

const Schema = z.object({
  game_id: z.string().min(1),
  nested: z.object({ count: z.number() }).optional(),
});

function logger() {
  return { log: vi.fn(), logError: vi.fn() };
}

function post(body: string) {
  return new Request("http://test/api/x", { method: "POST", body });
}

async function bodyOf(response: Response) {
  return (await response.json()) as {
    error: string;
    details?: { field: string | null };
  };
}

describe("readJsonRequest", () => {
  it("returns the parsed body when it fits the schema", async () => {
    const result = await readJsonRequest(
      post('{"game_id":"g"}'),
      Schema,
      logger(),
    );

    expect(result).toEqual({ ok: true, data: { game_id: "g" } });
  });

  it("answers 400 naming no field when the body is not JSON", async () => {
    const log = logger();

    const result = await readJsonRequest(post("{ nope"), Schema, log);

    if (result.ok) throw new Error("expected a refusal");
    expect(result.response.status).toBe(400);
    expect(await bodyOf(result.response)).toMatchObject({
      error: "Request body must be JSON",
      details: { field: null },
    });
    expect(log.log).toHaveBeenCalledWith("request.invalid", {
      reason: "invalid_request",
      field: null,
    });
  });

  it("answers 400 naming the field that is missing or wrong", async () => {
    const result = await readJsonRequest(post("{}"), Schema, logger());

    if (result.ok) throw new Error("expected a refusal");
    const body = await bodyOf(result.response);
    expect(result.response.status).toBe(400);
    expect(body.error).toContain("Invalid game_id");
    expect(body.details?.field).toBe("game_id");
  });

  it("names a nested field by its whole path", async () => {
    const result = await readJsonRequest(
      post('{"game_id":"g","nested":{"count":"x"}}'),
      Schema,
      logger(),
    );

    if (result.ok) throw new Error("expected a refusal");
    expect((await bodyOf(result.response)).details?.field).toBe("nested.count");
  });

  it("names the request itself when the body is the wrong kind of value", async () => {
    const result = await readJsonRequest(post("[]"), Schema, logger());

    if (result.ok) throw new Error("expected a refusal");
    const body = await bodyOf(result.response);
    expect(body.error).toContain("Invalid request");
    expect(body.details?.field).toBeNull();
  });
});

describe("readQueryRequest", () => {
  const QuerySchema = z.object({ game_id: z.string().min(1) });

  it("reads the query string", () => {
    const result = readQueryRequest(
      new Request("http://test/api/x?game_id=g"),
      QuerySchema,
      logger(),
    );

    expect(result).toEqual({ ok: true, data: { game_id: "g" } });
  });

  it("treats a parameter that is not there as absent and names it", async () => {
    const result = readQueryRequest(
      new Request("http://test/api/x"),
      QuerySchema,
      logger(),
    );

    if (result.ok) throw new Error("expected a refusal");
    expect((await bodyOf(result.response)).details?.field).toBe("game_id");
  });
});

describe("request logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the caller's request id, trimmed, and writes it on every line", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = new Request("http://test", {
      headers: { "x-request-id": "  abc " },
    });

    const log = createRequestLogger(req, "game-turn");
    log.log("hello", { game_id: "g" });
    log.logError("oops");

    expect(log.requestId).toBe("abc");
    expect(JSON.parse(out.mock.calls[0][0])).toMatchObject({
      event: "hello",
      endpoint: "game-turn",
      request_id: "abc",
      game_id: "g",
    });
    expect(JSON.parse(err.mock.calls[0][0])).toMatchObject({
      event: "oops",
      request_id: "abc",
    });
  });

  it("makes up an id when the header is missing or blank", () => {
    const missing = createRequestLogger(new Request("http://test"), "x");
    const blank = createRequestLogger(
      new Request("http://test", { headers: { "x-request-id": "   " } }),
      "x",
    );

    expect(missing.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(blank.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(blank.requestId).not.toBe(missing.requestId);
  });
});

describe("withLogContext", () => {
  it("adds its context to every line, and lets a line's own details win", () => {
    const inner = logger();

    const log = withLogContext(inner, { game_id: "g", action: "search" });
    log.log("a");
    log.log("b", { action: "talk" });
    log.logError("c", { reason: "r" });

    expect(inner.log).toHaveBeenNthCalledWith(1, "a", {
      game_id: "g",
      action: "search",
    });
    expect(inner.log).toHaveBeenNthCalledWith(2, "b", {
      game_id: "g",
      action: "talk",
    });
    expect(inner.logError).toHaveBeenCalledWith("c", {
      game_id: "g",
      action: "search",
      reason: "r",
    });
  });
});
