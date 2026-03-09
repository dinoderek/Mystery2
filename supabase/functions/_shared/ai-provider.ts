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

function inferMockAccusedCharacter(
  context: Record<string, unknown>,
): string | null {
  const explicitAccused = readOptionalContextString(context, "accused_character");
  if (explicitAccused) {
    return explicitAccused;
  }

  const playerInput = readOptionalContextString(context, "player_input");
  if (!playerInput) {
    return null;
  }
  const normalizedInput = playerInput.toLowerCase();

  const sharedMysteryContext = context.shared_mystery_context;
  if (
    typeof sharedMysteryContext !== "object" ||
    sharedMysteryContext === null ||
    Array.isArray(sharedMysteryContext)
  ) {
    return null;
  }

  const characterNamesRaw = (
    sharedMysteryContext as Record<string, unknown>
  ).character_names;
  if (!Array.isArray(characterNamesRaw)) {
    return null;
  }

  for (const value of characterNamesRaw) {
    if (typeof value !== "string") {
      continue;
    }
    const fullName = value.trim();
    if (!fullName) {
      continue;
    }
    const firstName = fullName.split(/\s+/u)[0] ?? "";
    if (!firstName) {
      continue;
    }
    if (normalizedInput.includes(firstName.toLowerCase())) {
      return firstName;
    }
  }

  return null;
}

function resolveMockCharacterTruth(
  context: Record<string, unknown>,
  inferredAccusedCharacter: string,
): boolean | null {
  const truthMapRaw = context.character_truth;
  if (
    typeof truthMapRaw !== "object" ||
    truthMapRaw === null ||
    Array.isArray(truthMapRaw)
  ) {
    return null;
  }

  const firstNameMatch = (truthMapRaw as Record<string, unknown>)[
    inferredAccusedCharacter
  ];
  if (typeof firstNameMatch === "boolean") {
    return firstNameMatch;
  }

  return null;
}

export function resolveAIProfile(env = getRuntimeEnv()): AIRuntimeProfile {
  const provider = parseProviderName(requireEnv(env, "AI_PROVIDER"));
  const model = requireEnv(env, "AI_MODEL");

  return {
    provider,
    model,
  };
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

function resolveOpenRouterRuntimeConfig(
  env: Record<string, string | undefined>,
): OpenRouterRuntimeConfig {
  return {
    timeout_ms: parsePositiveInt(env, "AI_OPENROUTER_TIMEOUT_MS", 45_000),
    max_attempts: parsePositiveInt(env, "AI_OPENROUTER_MAX_ATTEMPTS", 3),
    base_backoff_ms: parsePositiveInt(
      env,
      "AI_OPENROUTER_BASE_BACKOFF_MS",
      750,
    ),
  };
}

function resolveOpenRouterApiKey(
  env: Record<string, string | undefined>,
  explicitApiKey?: string | null,
): string {
  const keyFromProfile = explicitApiKey?.trim();
  if (keyFromProfile) {
    return keyFromProfile;
  }

  return requireEnv(env, "OPENROUTER_API_KEY");
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
        const accusedCharacter = readOptionalContextString(
          context,
          "accused_character",
        );
        const forcedByTimeout = context.forced_by_timeout === true;
        const stagePrompt = forcedByTimeout
          ? "Time is up. You must make your accusation now."
          : "The final accusation begins.";
        const suspectPrompt = accusedCharacter
          ? ` You are focusing on ${accusedCharacter}.`
          : "";
        return {
          narration: `[Mock] ${stagePrompt}${suspectPrompt} Present your reasoning before judgment.`,
          follow_up_prompt:
            "Who do you accuse, and what evidence, timeline, and motive support your case?",
        };
      }
      case "accusation_judge": {
        const round = requireContextNumber(role, context, "round");
        const inferredAccusedCharacter = inferMockAccusedCharacter(context);
        if (!inferredAccusedCharacter) {
          return {
            narration:
              "[Mock] I still cannot identify who you are accusing from your explanation.",
            accusation_resolution: "continue",
            follow_up_prompt:
              "State the suspect's name clearly, then explain why the evidence supports that accusation.",
            inferred_accused_character: null,
          };
        }

        const truthFromMap = resolveMockCharacterTruth(
          context,
          inferredAccusedCharacter,
        );
        const isCulprit =
          truthFromMap ??
          (context.is_culprit === true
            ? true
            : context.is_culprit === false
              ? false
              : false);
        const accusationResolution: AccusationResolution = round < 1
          ? "continue"
          : isCulprit
          ? "win"
          : "lose";

        return {
          narration:
            accusationResolution === "continue"
              ? `[Mock] I need a stronger chain of evidence before deciding on ${inferredAccusedCharacter}.`
              : accusationResolution === "win"
                ? `[Mock] The evidence is decisive. ${inferredAccusedCharacter} is guilty.`
                : `[Mock] The evidence does not support accusing ${inferredAccusedCharacter}.`,
          accusation_resolution: accusationResolution,
          follow_up_prompt:
            accusationResolution === "continue"
              ? "Which evidence directly connects this suspect to the event?"
              : null,
          inferred_accused_character: inferredAccusedCharacter,
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
      throw new Error("Missing OPENROUTER_API_KEY for provider=openrouter");
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
    const runtimeConfig = resolveOpenRouterRuntimeConfig(env);
    return new OpenRouterProvider(
      profile,
      resolveOpenRouterApiKey(env, options.openrouterApiKey),
      runtimeConfig,
      env.OPENROUTER_URL,
    );
  }

  return new MockAIProvider(profile);
}

export function getAIProvider(env = getRuntimeEnv()): AIProvider {
  const profile = resolveAIProfile(env);
  return createAIProviderFromProfile(profile, {
    env,
    openrouterApiKey: env.OPENROUTER_API_KEY,
  });
}
