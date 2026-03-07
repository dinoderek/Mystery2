import { describe, expect, it } from "vitest";
import {
  getAIProvider,
  isLiveAIEnabled,
  resolveAIProfile,
  resolveLiveProfiles,
} from "../../../supabase/functions/_shared/ai-provider.ts";
import {
  parseSearchOutput,
  parseAccusationJudgeOutput,
  parseTalkStartOutput,
} from "../../../supabase/functions/_shared/ai-contracts.ts";

describe("ai-provider profile resolution", () => {
  it("fails when required env is missing", () => {
    expect(() => resolveAIProfile({})).toThrow("AI_PROVIDER");
    expect(() => resolveAIProfile({ AI_PROVIDER: "mock" })).toThrow(
      "AI_PROFILE",
    );
    expect(() =>
      resolveAIProfile({ AI_PROVIDER: "mock", AI_PROFILE: "default" }),
    ).toThrow("AI_MODEL");
  });

  it("resolves profile/provider/model from env", () => {
    const profile = resolveAIProfile({
      AI_PROFILE: "cost_control",
      AI_PROVIDER: "openrouter",
      AI_MODEL: "test/cost-model",
    });

    expect(profile).toEqual({
      name: "cost_control",
      provider: "openrouter",
      model: "test/cost-model",
    });
  });

  it("parses live profile list and live toggle", () => {
    expect(
      resolveLiveProfiles({ AI_LIVE_PROFILES: "cost_control,default" }),
    ).toEqual(["cost_control", "default"]);
    expect(() => resolveLiveProfiles({})).toThrow("AI_LIVE_PROFILES");
    expect(isLiveAIEnabled({ AI_LIVE: "1" })).toBe(true);
    expect(isLiveAIEnabled({ AI_LIVE: "false" })).toBe(false);
  });
});

describe("ai-provider mock role output", () => {
  it("returns parseable role payloads", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_PROFILE: "default",
      AI_MODEL: "mock/default",
    });
    const output = await provider.generateRoleOutput({
      role: "talk_start",
      prompt: "prompt",
      context: { character_name: "Alice", location_name: "Kitchen" },
      parse: parseTalkStartOutput,
    });

    expect(output.narration).toContain("[Mock]");
  });

  it("supports accusation continue and resolved rounds", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_PROFILE: "default",
      AI_MODEL: "mock/default",
    });

    const firstRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: { accused_character: "Alice", round: 0, is_culprit: true },
      parse: parseAccusationJudgeOutput,
    });
    expect(firstRound.accusation_resolution).toBe("continue");
    expect(firstRound.follow_up_prompt).toBeTruthy();

    const secondRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: { accused_character: "Alice", round: 1, is_culprit: true },
      parse: parseAccusationJudgeOutput,
    });
    expect(secondRound.accusation_resolution).toBe("win");
    expect(secondRound.follow_up_prompt).toBeNull();
  });

  it("generates search narration from location context only", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_PROFILE: "default",
      AI_MODEL: "mock/default",
    });

    const output = await provider.generateRoleOutput({
      role: "search",
      prompt: "prompt",
      context: { location_name: "Kitchen" },
      parse: parseSearchOutput,
    });

    expect(output.narration).toContain("Kitchen");
  });

  it("fails parsing when output shape is invalid", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_PROFILE: "default",
      AI_MODEL: "mock/default",
    });

    await expect(
      provider.generateRoleOutput({
        role: "talk_start",
        prompt: "prompt",
        context: { character_name: "Alice", location_name: "Kitchen" },
        parse: () => {
          throw new Error("validation failed");
        },
      }),
    ).rejects.toThrow("validation failed");
  });

  it("fails mock generation when required context is missing", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_PROFILE: "default",
      AI_MODEL: "mock/default",
    });

    await expect(
      provider.generateRoleOutput({
        role: "talk_start",
        prompt: "prompt",
        context: {},
        parse: parseTalkStartOutput,
      }),
    ).rejects.toThrow("character_name");
  });
});
