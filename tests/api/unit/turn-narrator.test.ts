import { describe, expect, it, vi } from "vitest";

import {
  createAIRequestMetadata,
  type AIProvider,
} from "../../../packages/game-engine/src/ai-provider.ts";
import { RetriableAIError } from "../../../packages/game-engine/src/errors.ts";
import {
  askRole,
  narrate,
  rejectOutput,
  TURN_ENDPOINT,
} from "../../../packages/game-engine/src/turn/narrator.ts";
import type { TurnRuntime } from "../../../packages/game-engine/src/turn/types.ts";

/**
 * What the player gets when the narrator fails. A failure that can be retried
 * reaches them as it came; an answer the game cannot use is turned into the
 * same retriable failure, so the browser offers one retry either way.
 */

function runtimeWith(provider: Partial<AIProvider>, headers: HeadersInit = {}) {
  const log = vi.fn();
  const runtime: TurnRuntime = {
    req: new Request("http://test/api/game-turn", { headers }),
    request_id: "req-1",
    game_id: "game-1",
    provider: provider as AIProvider,
    logger: { log, logError: vi.fn() },
  };
  return { runtime, log };
}

const request = {
  role: "search",
  prompt: "p",
  context: {},
  parse: (raw: unknown) => raw,
} as unknown as Parameters<typeof askRole>[2];

describe("createAIRequestMetadata", () => {
  const base = { endpoint: "game-turn", action: "search", game_id: "g" };

  it("prefers the request id it was given", () => {
    const req = new Request("http://test", {
      headers: { "x-request-id": "header" },
    });

    expect(
      createAIRequestMetadata(req, { ...base, request_id: " given " })
        .request_id,
    ).toBe("given");
  });

  it("falls back to the request's header, then to a fresh id", () => {
    const withHeader = new Request("http://test", {
      headers: { "x-request-id": " header " },
    });
    const without = new Request("http://test");

    expect(createAIRequestMetadata(withHeader, base).request_id).toBe("header");
    expect(
      createAIRequestMetadata(without, { ...base, request_id: "  " })
        .request_id,
    ).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("narrate", () => {
  it("returns the narration, recording the action it served", async () => {
    const generateNarration = vi.fn().mockResolvedValue("You arrive.");
    const { runtime } = runtimeWith({ generateNarration });

    expect(await narrate(runtime, "enter", "prompt")).toBe("You arrive.");

    expect(generateNarration).toHaveBeenCalledWith(
      "prompt",
      expect.objectContaining({
        request_id: "req-1",
        endpoint: TURN_ENDPOINT,
        action: "enter",
        game_id: "game-1",
      }),
    );
  });

  it("logs a retriable failure and passes it on as it came", async () => {
    const failure = new RetriableAIError("busy", {
      code: "AI_RATE_LIMITED",
      status: 429,
    });
    const { runtime, log } = runtimeWith({
      generateNarration: vi.fn().mockRejectedValue(failure),
    });

    await expect(narrate(runtime, "enter", "p")).rejects.toBe(failure);

    expect(log).toHaveBeenCalledWith("request.ai_retriable", {
      game_id: "game-1",
      action: "enter",
      code: "AI_RATE_LIMITED",
      status: 429,
      error: "busy",
    });
  });

  it("passes on any other failure without logging it as retriable", async () => {
    const failure = new Error("bug");
    const { runtime, log } = runtimeWith({
      generateNarration: vi.fn().mockRejectedValue(failure),
    });

    await expect(narrate(runtime, "enter", "p")).rejects.toBe(failure);

    expect(log).not.toHaveBeenCalled();
  });

  it("logs a retriable failure that carries no status as a null status", async () => {
    const { runtime, log } = runtimeWith({
      generateNarration: vi
        .fn()
        .mockRejectedValue(new RetriableAIError("slow", {})),
    });

    await narrate(runtime, "enter", "p").catch(() => {});

    expect(log).toHaveBeenCalledWith(
      "request.ai_retriable",
      expect.objectContaining({ status: null }),
    );
  });
});

describe("askRole", () => {
  it("returns the role's output, with the action recorded in the metadata", async () => {
    const generateRoleOutput = vi
      .fn()
      .mockResolvedValue({ narration: "Found it." });
    const { runtime } = runtimeWith({ generateRoleOutput });

    expect(await askRole(runtime, "search", request)).toEqual({
      narration: "Found it.",
    });

    expect(generateRoleOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "search",
        metadata: expect.objectContaining({
          action: "search",
          endpoint: TURN_ENDPOINT,
        }),
      }),
    );
  });

  it("passes a retriable failure on as it came, and logs it", async () => {
    const failure = new RetriableAIError("busy", {
      code: "AI_UNAVAILABLE",
      status: 503,
    });
    const { runtime, log } = runtimeWith({
      generateRoleOutput: vi.fn().mockRejectedValue(failure),
    });

    await expect(askRole(runtime, "search", request)).rejects.toBe(failure);

    expect(log).toHaveBeenCalledWith(
      "request.ai_retriable",
      expect.objectContaining({
        action: "search",
        code: "AI_UNAVAILABLE",
        status: 503,
      }),
    );
  });

  it("turns an output that did not parse into a retriable invalid-output failure", async () => {
    const { runtime, log } = runtimeWith({
      generateRoleOutput: vi
        .fn()
        .mockRejectedValue(new SyntaxError("bad json")),
    });

    const failure = await askRole(runtime, "search", request).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(RetriableAIError);
    expect(failure).toMatchObject({
      message: "AI output validation failed",
      details: { code: "AI_INVALID_OUTPUT" },
    });
    expect(log).toHaveBeenCalledWith(
      "request.ai_retriable",
      expect.objectContaining({ code: "AI_INVALID_OUTPUT", action: "search" }),
    );
  });
});

describe("rejectOutput", () => {
  it("logs the reason and refuses with a retriable invalid-output failure", () => {
    const { runtime, log } = runtimeWith({});

    expect(() =>
      rejectOutput(runtime, "talk", "named a clue it does not hold"),
    ).toThrow(RetriableAIError);

    expect(log).toHaveBeenCalledWith("request.ai_retriable", {
      game_id: "game-1",
      action: "talk",
      code: "AI_INVALID_OUTPUT",
      error: "named a clue it does not hold",
    });
  });
});
