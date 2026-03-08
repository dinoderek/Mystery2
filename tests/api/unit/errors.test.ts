import { describe, expect, it } from "vitest";
import {
  asRetriableAIResponse,
  RetriableAIError,
} from "../../../supabase/functions/_shared/errors.ts";

describe("error helpers", () => {
  it("maps RetriableAIError to 503 response payload", async () => {
    const error = new RetriableAIError("OpenRouter temporary failure", {
      code: "OPENROUTER_TEMPORARY_FAILURE",
      status: 429,
    });

    const response = asRetriableAIResponse(error);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(503);

    const body = await response?.json();
    expect(body).toMatchObject({
      error: "OpenRouter temporary failure",
      details: {
        retriable: true,
        code: "OPENROUTER_TEMPORARY_FAILURE",
        status: 429,
      },
    });
  });

  it("returns null for non-retriable errors", () => {
    const response = asRetriableAIResponse(new Error("boom"));
    expect(response).toBeNull();
  });
});
