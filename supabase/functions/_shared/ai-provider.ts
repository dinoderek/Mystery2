import type { AIRoleName, AccusationResolution } from "./ai-contracts.ts";
import { RetriableAIError } from "./errors.ts";

export type AIProfileName = "default" | "cost_control";
export type AIProviderName = "mock" | "openrouter";

export interface AIRuntimeProfile {
  name: AIProfileName;
  provider: AIProviderName;
  model: string;
}

export interface AIRoleOutputRequest<T> {
  role: AIRoleName;
  prompt: string;
  context: Record<string, unknown>;
  parse: (payload: unknown) => T;
}

export interface ReasoningEvaluation {
  resolved: boolean;
  outcome?: "win" | "lose";
  narration: string;
  follow_up_prompt?: string | null;
}

export interface AIProvider {
  profile: AIRuntimeProfile;
  generateNarration(prompt: string): Promise<string>;
  generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T>;
  evaluateReasoning(context: {
    history: unknown[];
    accused_character: string;
    is_culprit: boolean;
    player_reasoning: string;
  }): Promise<ReasoningEvaluation>;
}

function getRuntimeEnv(): Record<string, string | undefined> {
  const denoGlobal = (
    globalThis as unknown as {
      Deno?: { env?: { toObject?: () => Record<string, string> } };
    }
  ).Deno;

  if (typeof denoGlobal?.env?.toObject === "function") {
    return denoGlobal.env.toObject();
  }

  return process.env as Record<string, string | undefined>;
}

function requireEnv(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseProviderName(rawProviderName: string): AIProviderName {
  if (rawProviderName === "mock" || rawProviderName === "openrouter") {
    return rawProviderName;
  }

  throw new Error(
    `Invalid AI_PROVIDER "${rawProviderName}". Expected "mock" or "openrouter".`,
  );
}

function parseProfileName(rawProfileName: string): AIProfileName {
  if (rawProfileName === "default" || rawProfileName === "cost_control") {
    return rawProfileName;
  }

  throw new Error(
    `Invalid AI_PROFILE "${rawProfileName}". Expected "default" or "cost_control".`,
  );
}

function requireContextString(
  role: AIRoleName,
  context: Record<string, unknown>,
  key: string,
): string {
  const value = context[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required ${role} context field: ${key}`);
  }

  return value.trim();
}

function requireContextNumber(
  role: AIRoleName,
  context: Record<string, unknown>,
  key: string,
): number {
  const value = context[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Missing required ${role} numeric context field: ${key}`);
  }

  return value;
}

function requireContextBoolean(
  role: AIRoleName,
  context: Record<string, unknown>,
  key: string,
): boolean {
  const value = context[key];
  if (typeof value !== "boolean") {
    throw new Error(`Missing required ${role} boolean context field: ${key}`);
  }

  return value;
}

export function resolveAIProfile(env = getRuntimeEnv()): AIRuntimeProfile {
  const provider = parseProviderName(requireEnv(env, "AI_PROVIDER"));
  const name = parseProfileName(requireEnv(env, "AI_PROFILE"));
  const model = requireEnv(env, "AI_MODEL");

  return {
    name,
    provider,
    model,
  };
}

export function isLiveAIEnabled(env = getRuntimeEnv()): boolean {
  const raw = env.AI_LIVE ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

export function resolveLiveProfiles(env = getRuntimeEnv()): AIProfileName[] {
  const raw = requireEnv(env, "AI_LIVE_PROFILES");

  const profiles = raw
    .split(",")
    .map((value) => parseProfileName(value.trim()))
    .filter((value, index, all) => all.indexOf(value) === index);

  if (profiles.length === 0) {
    throw new Error("AI_LIVE_PROFILES must include at least one profile");
  }

  return profiles;
}

class MockAIProvider implements AIProvider {
  readonly profile: AIRuntimeProfile;

  constructor(profile: AIRuntimeProfile) {
    this.profile = profile;
  }

  async generateNarration(prompt: string): Promise<string> {
    return `[Mock] Narration for: ${prompt.slice(0, 70)}...`;
  }

  async generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T> {
    const payload = this.buildPayload(request.role, request.context);
    return request.parse(payload);
  }

  async evaluateReasoning(context: {
    history: unknown[];
    accused_character: string;
    is_culprit: boolean;
    player_reasoning: string;
  }): Promise<ReasoningEvaluation> {
    const rounds = Array.isArray(context.history) ? context.history.length : 0;
    if (rounds < 1) {
      return {
        resolved: false,
        narration:
          "[Mock] Your accusation is bold. Explain which evidence proves your theory.",
        follow_up_prompt:
          "Which evidence and timeline details most strongly support this accusation?",
      };
    }

    return {
      resolved: true,
      outcome: context.is_culprit ? "win" : "lose",
      narration: context.is_culprit
        ? `[Mock] You solved it. ${context.accused_character} is the culprit.`
        : `[Mock] The accusation fails. ${context.accused_character} is not the culprit.`,
      follow_up_prompt: null,
    };
  }

  private buildPayload(
    role: AIRoleName,
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (role) {
      case "talk_start": {
        const characterName = requireContextString(
          role,
          context,
          "character_name",
        );
        const locationName = requireContextString(
          role,
          context,
          "location_name",
        );
        return {
          narration: `[Mock] ${characterName} greets you in ${locationName} and waits for your questions.`,
        };
      }
      case "talk_conversation": {
        const characterName = requireContextString(
          role,
          context,
          "character_name",
        );
        const playerInput = requireContextString(role, context, "player_input");
        return {
          narration: `[Mock] ${characterName} responds thoughtfully to: "${playerInput}".`,
        };
      }
      case "talk_end": {
        const characterName = requireContextString(
          role,
          context,
          "character_name",
        );
        return {
          narration: `[Mock] You end the conversation with ${characterName}.`,
        };
      }
      case "search": {
        const locationName = requireContextString(
          role,
          context,
          "location_name",
        );
        return {
          narration: `[Mock] You search ${locationName} and inspect the area carefully.`,
        };
      }
      case "accusation_start": {
        const accusedCharacter = requireContextString(
          role,
          context,
          "accused_character",
        );
        return {
          narration: `[Mock] You accuse ${accusedCharacter}. Present your reasoning before judgment.`,
          follow_up_prompt:
            "Explain your evidence, timeline, and motive in one clear argument.",
        };
      }
      case "accusation_judge": {
        const accusedCharacter = requireContextString(
          role,
          context,
          "accused_character",
        );
        const round = requireContextNumber(role, context, "round");
        const isCulprit = requireContextBoolean(role, context, "is_culprit");
        const accusationResolution: AccusationResolution =
          round < 1 ? "continue" : isCulprit ? "win" : "lose";

        return {
          narration:
            accusationResolution === "continue"
              ? `[Mock] I need a stronger chain of evidence before deciding on ${accusedCharacter}.`
              : accusationResolution === "win"
                ? `[Mock] The evidence is decisive. ${accusedCharacter} is guilty.`
                : `[Mock] The evidence does not support accusing ${accusedCharacter}.`,
          accusation_resolution: accusationResolution,
          follow_up_prompt:
            accusationResolution === "continue"
              ? "Which evidence directly connects this suspect to the event?"
              : null,
        };
      }
    }
  }
}

class OpenRouterProvider implements AIProvider {
  readonly profile: AIRuntimeProfile;
  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor(profile: AIRuntimeProfile, apiKey: string, baseUrl?: string) {
    if (!apiKey) {
      throw new Error("Missing OPENROUTER_API_KEY for provider=openrouter");
    }

    this.profile = profile;
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl ?? "https://openrouter.ai/api/v1/chat/completions";
  }

  async generateNarration(prompt: string): Promise<string> {
    const content = await this.callOpenRouter([
      {
        role: "system",
        content:
          "You are the narrator for a kids mystery game. Return plain text only.",
      },
      { role: "user", content: prompt },
    ]);

    return content.trim();
  }

  async generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T> {
    const content = await this.callOpenRouter(
      [
        {
          role: "system",
          content: `You are a strict JSON API for role "${request.role}". Output JSON only.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt: request.prompt,
            context: request.context,
          }),
        },
      ],
      { type: "json_object" },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (_error) {
      throw new Error(
        `OpenRouter returned non-JSON payload for ${request.role}`,
      );
    }

    return request.parse(parsed);
  }

  async evaluateReasoning(context: {
    history: unknown[];
    accused_character: string;
    is_culprit: boolean;
    player_reasoning: string;
  }): Promise<ReasoningEvaluation> {
    const rounds = Array.isArray(context.history) ? context.history.length : 0;
    const resolved = rounds > 0;

    return {
      resolved,
      outcome: resolved ? (context.is_culprit ? "win" : "lose") : undefined,
      narration: await this.generateNarration(
        `Accused: ${context.accused_character}. Reasoning: ${context.player_reasoning}`,
      ),
      follow_up_prompt: resolved
        ? null
        : "Can you cite specific evidence and a timeline to support this accusation?",
    };
  }

  private async callOpenRouter(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    responseFormat?: { type: "json_object" },
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(this.#baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.profile.model,
          messages,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const details = await response.text();
        if (
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          throw new RetriableAIError("OpenRouter temporary failure", {
            code: "OPENROUTER_TEMPORARY_FAILURE",
            status: response.status,
            provider_details: details,
          });
        }

        throw new Error(`OpenRouter error (${response.status}): ${details}`);
      }

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;

      if (typeof content === "string") {
        return content;
      }

      if (Array.isArray(content)) {
        return content
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("");
      }

      throw new Error("OpenRouter response missing assistant content");
    } catch (error) {
      if (error instanceof RetriableAIError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new RetriableAIError("OpenRouter request timed out", {
          code: "OPENROUTER_TIMEOUT",
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getAIProvider(env = getRuntimeEnv()): AIProvider {
  const profile = resolveAIProfile(env);
  if (profile.provider === "openrouter") {
    return new OpenRouterProvider(
      profile,
      requireEnv(env, "OPENROUTER_API_KEY"),
      env.OPENROUTER_URL,
    );
  }

  return new MockAIProvider(profile);
}
