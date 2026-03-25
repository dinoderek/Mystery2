import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  callLiveEndpointWithRetry,
  getLiveTestTimeoutMs,
  getLiveSuiteTitle,
  isLiveAIEnabled,
  LiveAIRetriableExhaustedError,
  resolveLiveAILabel,
} from "../../testkit/src/live-ai.ts";
import {
  setupApiTestAuth,
  type ApiAuthContext,
} from "../integration/auth-helpers.ts";
import { investigatorScript } from "./live-ai/investigator-script.ts";

const API_URL = "http://127.0.0.1:54331/functions/v1";
const runLive = isLiveAIEnabled() ? describe : describe.skip;

const endpointByAction: Record<string, string> = {
  move: "game-move",
  search: "game-search",
  talk: "game-talk",
  ask: "game-ask",
  end_talk: "game-end-talk",
  accuse_reasoning: "game-accuse",
};

runLive(getLiveSuiteTitle("live-ai e2e investigator flow"), () => {
  let auth: ApiAuthContext;

  beforeAll(async () => {
    auth = await setupApiTestAuth("live-ai-e2e-flow");
  });

  afterAll(async () => {
    await auth.cleanup();
  });

  it("executes the deterministic investigator script", async () => {
    try {
      const label = resolveLiveAILabel().toLowerCase();
      const profile = label === "free" || label === "paid" ? label : "free";
      const headers = auth.headers;

      const startData = await callLiveEndpointWithRetry<{ game_id: string }>({
        apiUrl: API_URL,
        endpoint: "game-start",
        headers,
        stepLabel: "game-start",
        body: {
          blueprint_id: investigatorScript.blueprint_id,
          ai_profile: profile,
        },
      });
      const { game_id } = startData;
      expect(typeof game_id).toBe("string");

      for (const [index, step] of investigatorScript.steps.entries()) {
        const endpoint = endpointByAction[step.action];
        const data = await callLiveEndpointWithRetry<{
          narration_parts: Array<{ text: string }>;
          mode?: string;
        }>({
          apiUrl: API_URL,
          endpoint,
          headers,
          stepLabel: `step-${index + 1} action=${step.action}`,
          body: {
            game_id,
            ...step.payload,
          },
        });
        expect(Array.isArray(data.narration_parts)).toBe(true);
        expect(data.narration_parts.length).toBeGreaterThan(0);

        if (step.expect_mode) {
          if (step.expect_mode === "accuse") {
            expect(data.mode === "accuse" || data.mode === "ended").toBe(true);
          } else {
            expect(data.mode).toBe(step.expect_mode);
          }
        }

        if (data.mode === "ended") {
          break;
        }
      }

      const finalStateRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
        headers,
      });
      expect(finalStateRes.status).toBe(200);
      const finalStateData = await finalStateRes.json();
      expect(finalStateData.state.mode).toBe("ended");
    } catch (error) {
      if (error instanceof LiveAIRetriableExhaustedError) {
        expect.fail(`[live-ai] Retriable retries exhausted: ${error.message}`);
      }
      throw error;
    }
  }, getLiveTestTimeoutMs());
});
