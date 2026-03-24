import type { AIRoleName, AccusationResolution } from "./ai-contracts.ts";
import { RetriableAIError } from "./errors.ts";

export type AIProviderName = "mock" | "openrouter";

export interface AIRequestMetadata {
  request_id: string;
  endpoint: string;
  action: string;
  game_id?: string;
}

export function createAIRequestMetadata(
  req: Request,
  base: Omit<AIRequestMetadata, "request_id"> & { request_id?: string },
): AIRequestMetadata {
  const { request_id: requestIdFromBase, ...metadataBase } = base;
  const explicitRequestId = requestIdFromBase?.trim();
  const headerRequestId = req.headers.get("x-request-id")?.trim();
  return {
    request_id:
      explicitRequestId && explicitRequestId.length > 0
        ? explicitRequestId
        : headerRequestId && headerRequestId.length > 0
        ? headerRequestId
        : crypto.randomUUID(),
    ...metadataBase,
  };
}

export interface AIRuntimeProfile {
  provider: AIProviderName;
  model: string;
}

export interface AIProviderFactoryOptions {
  env?: Record<string, string | undefined>;
  openrouterApiKey?: string | null;
}

export interface AIRoleOutputRequest<T> {
  role: AIRoleName;
  prompt: string;
  context: Record<string, unknown>;
  parse: (payload: unknown) => T;
  metadata?: AIRequestMetadata;
}

export interface ReasoningEvaluation {
  resolved: boolean;
  outcome?: "win" | "lose";
  narration: string;
  follow_up_prompt?: string | null;
}

export interface AIProvider {
  profile: AIRuntimeProfile;
  generateNarration(
    prompt: string,
    metadata?: AIRequestMetadata,
  ): Promise<string>;
  generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T>;
  evaluateReasoning(context: {
    history: unknown[];
    accused_character: string;
    is_culprit: boolean;
    player_reasoning: string;
  }, metadata?: AIRequestMetadata): Promise<ReasoningEvaluation>;
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

function readOptionalContextString(
  context: Record<string, unknown>,
  key: string,
): string | null {
  const value = context[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCharacterSex(value: unknown): "male" | "female" | null {
  return value === "male" || value === "female" ? value : null;
}

function pronounForSex(sex: "male" | "female" | null): string {
  return sex === "male" ? "he" : sex === "female" ? "she" : "they";
}

function inferMentionedCharacter(
  context: Record<string, unknown>,
): string | null {
  const playerInput = readOptionalContextString(context, "player_input");
  if (!playerInput) {
    return null;
  }
  const normalizedInput = playerInput.toLowerCase();

  const accusationJudgeContext = context.accusation_judge_context;
  if (
    typeof accusationJudgeContext !== "object" ||
    accusationJudgeContext === null ||
    Array.isArray(accusationJudgeContext)
  ) {
    return null;
  }

  const fullBlueprint = (
    accusationJudgeContext as Record<string, unknown>
  ).full_blueprint;
  if (
    typeof fullBlueprint !== "object" ||
    fullBlueprint === null ||
    Array.isArray(fullBlueprint)
  ) {
    return null;
  }

  const world = (fullBlueprint as Record<string, unknown>).world;
  if (typeof world !== "object" || world === null || Array.isArray(world)) {
    return null;
  }

  const charactersRaw = (world as Record<string, unknown>).characters;
  if (!Array.isArray(charactersRaw)) {
    return null;
  }

  for (const value of charactersRaw) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const firstNameRaw = (value as Record<string, unknown>).first_name;
    if (typeof firstNameRaw !== "string") {
      continue;
    }
    const firstName = firstNameRaw.trim();
    if (!firstName) {
      continue;
    }
    if (normalizedInput.includes(firstName.toLowerCase())) {
      return firstName;
    }
  }

  return null;
}

export function isLiveAIEnabled(env = getRuntimeEnv()): boolean {
  const raw = env.AI_LIVE ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

function parsePositiveInt(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${key} "${raw}". Expected a positive integer value.`,
    );
  }
  return parsed;
}

interface OpenRouterRuntimeConfig {
  timeout_ms: number;
  max_attempts: number;
  base_backoff_ms: number;
}

const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;

function resolveOpenRouterRuntimeConfig(
  env: Record<string, string | undefined>,
): OpenRouterRuntimeConfig {
  return {
    timeout_ms: parsePositiveInt(
      env,
      "AI_OPENROUTER_TIMEOUT_MS",
      DEFAULT_OPENROUTER_TIMEOUT_MS,
    ),
    max_attempts: parsePositiveInt(env, "AI_OPENROUTER_MAX_ATTEMPTS", 3),
    base_backoff_ms: parsePositiveInt(
      env,
      "AI_OPENROUTER_BASE_BACKOFF_MS",
      750,
    ),
  };
}

class MockAIProvider implements AIProvider {
  readonly profile: AIRuntimeProfile;

  constructor(profile: AIRuntimeProfile) {
    this.profile = profile;
  }

  async generateNarration(
    prompt: string,
    _metadata?: AIRequestMetadata,
  ): Promise<string> {
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
  }, _metadata?: AIRequestMetadata): Promise<ReasoningEvaluation> {
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
        const talkContext = context.talk_context as
          | {
            active_character?: {
              first_name?: string | null;
              appearance?: string | null;
              background?: string | null;
              sex?: unknown;
            };
            active_location_name?: string | null;
          }
          | undefined;
        const characterName =
          talkContext?.active_character?.first_name ??
          requireContextString(role, context, "character_name");
        const locationName =
          talkContext?.active_location_name ??
          requireContextString(role, context, "location_name");
        const appearance = talkContext?.active_character?.appearance ?? "a familiar face";
        const background = talkContext?.active_character?.background ?? "someone tied to the case";
        const pronoun = pronounForSex(
          readCharacterSex(talkContext?.active_character?.sex),
        );
        return {
          narration:
            `[Mock] You approach ${characterName} in ${locationName}. ${pronoun} appears ${appearance} and carries the air of ${background}.`,
        };
      }
      case "talk_conversation": {
        const talkCtx = context.talk_context as
          | { active_character?: { first_name?: string | null } }
          | undefined;
        const characterName =
          talkCtx?.active_character?.first_name ??
          requireContextString(role, context, "character_name");
        const playerInput = requireContextString(role, context, "player_input");
        return {
          narration: `[Mock] ${characterName} responds thoughtfully to: "${playerInput}".`,
        };
      }
      case "talk_end": {
        const talkCtx = context.talk_context as
          | { active_character?: { first_name?: string | null } }
          | undefined;
        const characterName =
          talkCtx?.active_character?.first_name ??
          requireContextString(role, context, "character_name");
        return {
          narration:
            `[Mock] You step back from ${characterName} and return to looking around.`,
        };
      }
      case "search": {
        const searchContext = context.search_context as
          | {
            location_name?: string | null;
            next_clue?: { text?: string } | string | null;
          }
          | undefined;
        const locationName =
          (typeof searchContext?.location_name === "string"
            ? searchContext.location_name
            : null) ??
          requireContextString(role, context, "location_name");
        const rawNextClue = searchContext?.next_clue;
        const nextClue =
          rawNextClue && typeof rawNextClue === "object" && "text" in rawNextClue
            ? (rawNextClue.text as string)?.trim() || null
            : typeof rawNextClue === "string" && rawNextClue.trim().length > 0
              ? rawNextClue.trim()
              : null;
        return {
          narration: nextClue
            ? `[Mock] You search ${locationName} and uncover a clue: ${nextClue}`
            : `[Mock] You search ${locationName} again, but discover no new clue.`,
        };
      }
      case "accusation_start": {
        const forcedByTimeout = context.forced_by_timeout === true;
        const stagePrompt = forcedByTimeout
          ? "Time is up. You must make your accusation now."
          : "The final accusation begins.";
        return {
          narration: `[Mock] ${stagePrompt} Present your reasoning before judgment.`,
          follow_up_prompt:
            "Who do you accuse, and what evidence, timeline, and motive support your case?",
        };
      }
      case "accusation_judge": {
        const accusationJudgeContext = context.accusation_judge_context as
          | { round?: number; full_blueprint?: { world?: { characters?: Array<Record<string, unknown>> } } }
          | undefined;
        const round = accusationJudgeContext?.round ??
          requireContextNumber(role, context, "round");
        const mentionedCharacter = inferMentionedCharacter(context);
        if (!mentionedCharacter) {
          return {
            narration: "[Mock] I need a clearer suspect and stronger evidence.",
            accusation_resolution: "continue",
            follow_up_prompt:
              "State the suspect's name clearly, then explain why the evidence supports that accusation.",
          };
        }

        const normalizedCharacter = mentionedCharacter.toLowerCase();
        const culpritFirstName = Array.isArray(
            accusationJudgeContext?.full_blueprint?.world?.characters,
          )
          ? accusationJudgeContext?.full_blueprint?.world?.characters.find(
              (entry) => entry.is_culprit === true,
            )?.first_name
          : null;
        const isCulprit = typeof culpritFirstName === "string"
          ? culpritFirstName.trim().toLowerCase() === normalizedCharacter
          : normalizedCharacter !== "bob";
        const accusationResolution: AccusationResolution = round < 1
          ? "continue"
          : isCulprit
          ? "win"
          : "lose";

        return {
          narration:
            accusationResolution === "continue"
              ? "[Mock] I need a stronger chain of evidence before deciding."
              : accusationResolution === "win"
                ? "[Mock] The evidence is decisive. Your accusation is correct."
                : "[Mock] The evidence does not support your accusation.",
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
  readonly #runtimeConfig: OpenRouterRuntimeConfig;

  constructor(
    profile: AIRuntimeProfile,
    apiKey: string,
    runtimeConfig: OpenRouterRuntimeConfig,
    baseUrl?: string,
  ) {
    if (!apiKey) {
      throw new Error("Missing openrouter_api_key for provider=openrouter profile");
    }

    this.profile = profile;
    this.#apiKey = apiKey;
    this.#runtimeConfig = runtimeConfig;
    this.#baseUrl = baseUrl ?? "https://openrouter.ai/api/v1/chat/completions";
  }

  async generateNarration(
    prompt: string,
    metadata?: AIRequestMetadata,
  ): Promise<string> {
    const content = await this.callOpenRouter([
      {
        role: "system",
        content:
          "You are the narrator for a kids mystery game. Return plain text only.",
      },
      { role: "user", content: prompt },
    ], undefined, metadata, "narration");

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
      request.metadata,
      request.role,
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
  }, metadata?: AIRequestMetadata): Promise<ReasoningEvaluation> {
    const rounds = Array.isArray(context.history) ? context.history.length : 0;
    const resolved = rounds > 0;

    return {
      resolved,
      outcome: resolved ? (context.is_culprit ? "win" : "lose") : undefined,
      narration: await this.generateNarration(
        `Accused: ${context.accused_character}. Reasoning: ${context.player_reasoning}`,
        metadata,
      ),
      follow_up_prompt: resolved
        ? null
        : "Can you cite specific evidence and a timeline to support this accusation?",
    };
  }

  private async callOpenRouter(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    responseFormat?: { type: "json_object" },
    metadata?: AIRequestMetadata,
    role = "narration",
  ): Promise<string> {
    const baseLogData: Record<string, unknown> = {
      request_id: metadata?.request_id ?? "untracked",
      endpoint: metadata?.endpoint ?? "unknown",
      action: metadata?.action ?? "unknown",
      game_id: metadata?.game_id ?? null,
      role,
      provider: this.profile.provider,
      model: this.profile.model,
    };

    for (let attempt = 1; attempt <= this.#runtimeConfig.max_attempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const content = await this.callOpenRouterOnce(messages, responseFormat);
        this.logStructured({
          ...baseLogData,
          outcome: "success",
          attempt,
          latency_ms: Date.now() - startedAt,
        });
        return content;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (error instanceof RetriableAIError) {
          const isRetrying = attempt < this.#runtimeConfig.max_attempts;
          this.logStructured({
            ...baseLogData,
            outcome: isRetrying ? "retry" : "failure",
            attempt,
            latency_ms: latencyMs,
            retriable: true,
            retriable_code: error.details.code ?? null,
            retriable_status: error.details.status ?? null,
            error: error.message,
          });

          if (isRetrying) {
            await this.sleep(this.computeBackoff(attempt));
            continue;
          }
        } else {
          this.logStructured({
            ...baseLogData,
            outcome: "failure",
            attempt,
            latency_ms: latencyMs,
            retriable: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        throw error;
      }
    }

    throw new Error("OpenRouter retry loop exited unexpectedly");
  }

  private async callOpenRouterOnce(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    responseFormat?: { type: "json_object" },
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#runtimeConfig.timeout_ms,
    );

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

  private computeBackoff(attempt: number): number {
    const multiplier = Math.max(1, 2 ** (attempt - 1));
    return Math.min(this.#runtimeConfig.base_backoff_ms * multiplier, 15_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logStructured(payload: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "ai.openrouter.call",
        ...payload,
      }),
    );
  }
}

export function createAIProviderFromProfile(
  profile: AIRuntimeProfile,
  options: AIProviderFactoryOptions = {},
): AIProvider {
  const env = options.env ?? getRuntimeEnv();
  if (profile.provider === "openrouter") {
    const openrouterApiKey = options.openrouterApiKey?.trim();
    if (!openrouterApiKey) {
      throw new Error(
        "Missing openrouter_api_key for provider=openrouter profile",
      );
    }
    const runtimeConfig = resolveOpenRouterRuntimeConfig(env);
    return new OpenRouterProvider(
      profile,
      openrouterApiKey,
      runtimeConfig,
      env.OPENROUTER_URL,
    );
  }

  return new MockAIProvider(profile);
}
