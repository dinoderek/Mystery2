import type { AIRoleName, AccusationResolution } from "./ai-contracts.ts";
import { withCallLog } from "./ai-call-log.ts";
import { readArrivalPrompt } from "./ai-prompts.ts";
import {
  ClaudeCliProvider,
  type ClaudeCliRuntimeConfig,
} from "./ai-provider-claude-cli.ts";
import { RetriableAIError } from "./errors.ts";

export type AIProviderName = "mock" | "openrouter" | "claude-cli";

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

/** What the most recent call cost, where the provider reports it. */
export interface AICallUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  attempts: number;
}

export interface AIProvider {
  profile: AIRuntimeProfile;
  /**
   * Model id that produced the most recent response. For OpenRouter this is the
   * model the API reports serving the request, which can differ from the
   * requested `profile.model` under routing or fallback; for the mock provider
   * it is the configured `profile.model`. Reads the configured model until the
   * first successful call updates it.
   */
  readonly resolvedModel: string;
  generateNarration(
    prompt: string,
    metadata?: AIRequestMetadata,
  ): Promise<string>;
  generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T>;
  /** Usage of the most recent call; only the claude CLI reports it. */
  readonly lastUsage?: AICallUsage | null;
}

function getRuntimeEnv(): Record<string, string | undefined> {
  return process.env;
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

/**
 * Deterministic gibberish heuristic for the mock runtime so tests can exercise
 * the unintelligible-input path. A word made only of consonants (keyboard mash
 * like "asdfgh") reads as nonsense; anything with a vowel is treated as
 * understood. The live provider judges this via the prompt instead.
 */
function looksUnintelligible(text: string): boolean {
  const letters = text.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length < 2) {
    return false;
  }
  return !/[aeiouy]/.test(letters);
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

const DEFAULT_CLAUDE_CLI_TIMEOUT_MS = 120_000;

function resolveClaudeCliRuntimeConfig(
  env: Record<string, string | undefined>,
): ClaudeCliRuntimeConfig {
  return {
    binary: env.CLAUDE_CLI_PATH?.trim() || "claude",
    timeout_ms: parsePositiveInt(
      env,
      "AI_CLAUDE_CLI_TIMEOUT_MS",
      DEFAULT_CLAUDE_CLI_TIMEOUT_MS,
    ),
    max_attempts: parsePositiveInt(env, "AI_CLAUDE_CLI_MAX_ATTEMPTS", 3),
    base_backoff_ms: parsePositiveInt(env, "AI_CLAUDE_CLI_BASE_BACKOFF_MS", 750),
  };
}

class MockAIProvider implements AIProvider {
  readonly profile: AIRuntimeProfile;

  constructor(profile: AIRuntimeProfile) {
    this.profile = profile;
  }

  get resolvedModel(): string {
    return this.profile.model;
  }

  async generateNarration(prompt: string): Promise<string> {
    // An arrival names the place and who is there — names only, so nothing
    // from a present character's private pack ever reaches the transcript.
    const arrival = readArrivalPrompt(prompt);
    if (arrival) {
      const present = arrival.character_names.map((name) => ` ${name} is here.`).join("");
      return `[Mock] You arrive at ${arrival.destination_name}.${present}`;
    }
    return `[Mock] Narration for: ${prompt.slice(0, 70)}...`;
  }

  async generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T> {
    const payload = this.buildPayload(request.role, request.context);
    return request.parse(payload);
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
              tells?: Array<{ text?: string; trigger?: { kind?: string } }>;
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
        const pronoun = pronounForSex(
          readCharacterSex(talkContext?.active_character?.sex),
        );
        // A greeting has no player message, so only an `always` tell can
        // show; condition- and clue-triggered tells are never earned here.
        const ambientTell = talkContext?.active_character?.tells?.find(
          (tell) => tell.trigger?.kind === "always" && tell.text,
        );
        return {
          narration:
            `[Mock] You walk up to ${characterName} in ${locationName}. ${pronoun} looks ${appearance}.` +
            (ambientTell ? ` (${ambientTell.text})` : ""),
        };
      }
      case "talk_conversation": {
        const talkCtx = context.talk_context as
          | {
            active_character?: {
              first_name?: string | null;
              clues?: Array<{
                id?: string;
                text?: string;
                prereqs_met?: boolean;
                known_to_player?: boolean;
              }>;
            };
          }
          | undefined;
        const characterName =
          talkCtx?.active_character?.first_name ??
          requireContextString(role, context, "character_name");
        const playerInput = requireContextString(role, context, "player_input");
        if (looksUnintelligible(playerInput)) {
          return {
            narration: `[Mock] ${characterName} blinked. "Sorry — what?"`,
            revealed_clue_ids: [],
            revealed_off_script: [],
            input_understood: false,
          };
        }
        // Clues the player already holds are never reported again.
        const clues = (talkCtx?.active_character?.clues ?? []).filter(
          (c) => c.known_to_player !== true,
        );
        // Deterministic brilliance trigger: a whole-word sentinel in the player's
        // input ("aha"/"i bet") unlocks the first gated clue off-script. Word
        // boundaries avoid matching inside ordinary words (e.g. "Sahara").
        const isBrilliant = /\b(aha|i bet)\b/i.test(playerInput);
        if (isBrilliant) {
          const locked = clues.find((c) => c.prereqs_met === false && c.id);
          if (locked?.id) {
            return {
              narration: `[Mock] ${characterName} hesitates, then lets it slip: ${locked.text}`,
              revealed_clue_ids: [locked.id],
              revealed_off_script: [locked.id],
              input_understood: true,
            };
          }
        }
        // Otherwise reveal the first unlocked clue.
        const unlocked = clues.find((c) => c.prereqs_met !== false && c.id);
        if (unlocked?.id) {
          return {
            narration: `[Mock] ${characterName} thinks, then says: ${unlocked.text}`,
            revealed_clue_ids: [unlocked.id],
            revealed_off_script: [],
            input_understood: true,
          };
        }
        return {
          narration: `[Mock] ${characterName} thinks about your question: "${playerInput}".`,
          revealed_clue_ids: [],
          revealed_off_script: [],
          input_understood: true,
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
            `[Mock] You say goodbye to ${characterName} and look around again.`,
        };
      }
      case "search": {
        const searchContext = context.search_context as
          | {
            location_name?: string | null;
            next_clue?: { id?: string; text?: string } | string | null;
            search_query?: string | null;
            sub_locations?: Array<{
              unrevealed_clues?: Array<{ id?: string; text?: string }>;
              has_unrevealed_clues?: boolean;
              name?: string;
            }>;
          }
          | undefined;
        const locationName =
          (typeof searchContext?.location_name === "string"
            ? searchContext.location_name
            : null) ??
          requireContextString(role, context, "location_name");
        const rawNextClue = searchContext?.next_clue;
        const nextClueObj =
          rawNextClue && typeof rawNextClue === "object" && "text" in rawNextClue
            ? rawNextClue
            : null;
        const nextClueText = nextClueObj?.text?.trim() || (
          typeof rawNextClue === "string" && rawNextClue.trim().length > 0
            ? rawNextClue.trim()
            : null
        );
        const nextClueId = nextClueObj?.id ?? null;
        const searchQuery = searchContext?.search_query ?? null;

        // For targeted search, try to match the first sub-location with unrevealed clues
        if (searchQuery && searchContext?.sub_locations) {
          if (looksUnintelligible(searchQuery)) {
            return {
              narration: `[Mock] You poke around ${locationName}, but you're not sure what you're even looking for.`,
              revealed_clue_id: null,
              costs_turn: false,
              input_understood: false,
            };
          }
          const matchedSub = searchContext.sub_locations.find(
            (sl) => sl.has_unrevealed_clues,
          );
          if (matchedSub?.unrevealed_clues?.[0]) {
            const clue = matchedSub.unrevealed_clues[0];
            return {
              narration: `[Mock] You search ${matchedSub.name} in ${locationName} and uncover a clue: ${clue.text}`,
              revealed_clue_id: clue.id ?? null,
              costs_turn: true,
              input_understood: true,
            };
          }
          return {
            narration: `[Mock] You look through ${locationName} for "${searchQuery}", but find nothing.`,
            revealed_clue_id: null,
            costs_turn: false,
            input_understood: true,
          };
        }

        return {
          narration: nextClueText
            ? `[Mock] You search ${locationName} and uncover a clue: ${nextClueText}`
            : `[Mock] You search ${locationName} again, but discover no new clue.`,
          revealed_clue_id: nextClueId ?? null,
          costs_turn: true,
          input_understood: true,
        };
      }
      case "accusation_start": {
        const forcedByTimeout = context.forced_by_timeout === true;
        const stagePrompt = forcedByTimeout
          ? "Time is up. You must make your accusation now."
          : "The final accusation begins.";
        return {
          narration: `[Mock] ${stagePrompt} Who did it, and how do you know?`,
        };
      }
      case "accusation_judge": {
        const accusationJudgeContext = context.accusation_judge_context as
          | {
            round?: number;
            full_blueprint?: { world?: { characters?: Array<Record<string, unknown>> } };
            path_coverage?: Array<{ kind?: string; summary?: string; missing_clue_ids?: string[] }>;
          }
          | undefined;
        const round = accusationJudgeContext?.round ??
          requireContextNumber(role, context, "round");
        const mentionedCharacter = inferMentionedCharacter(context);
        if (!mentionedCharacter) {
          return {
            narration: "[Mock] I am not sure yet. Who do you think did it, and what clue shows it?",
            accusation_resolution: "continue",
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
        // Mirrors the live judge semantics: a wrong or unsupported accusation
        // is rejected with encouragement ("continue") until round 3, when the
        // case finally resolves "lose". A correct culprit wins from round 1.
        const accusationResolution: AccusationResolution = round < 1
          ? "continue"
          : isCulprit
          ? "win"
          : round >= 3
          ? "lose"
          : "continue";

        // Mirrors the live judge's use of path_coverage: on a rejection, steer
        // the closing question at a solution path the investigator has not
        // finished, rather than asking a generic one.
        const unfinishedSolutionPath = accusationJudgeContext?.path_coverage?.find(
          (entry) =>
            entry?.kind === "solution" && (entry.missing_clue_ids?.length ?? 0) > 0,
        );

        return {
          narration:
            accusationResolution === "win"
              ? "[Mock] The clues all fit. You got it right!"
              : accusationResolution === "lose"
              ? "[Mock] The case ends here. This time the answer got away."
              : round < 1
              ? "[Mock] I need one more clue before I can be sure. What else do you know?"
              : unfinishedSolutionPath?.summary
              ? `[Mock] Not yet. There is more to know about ${unfinishedSolutionPath.summary}. What clue shows it was them?`
              : "[Mock] Not yet. Look at your clues again. Do you want to have another go?",
          accusation_resolution: accusationResolution,
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
  #resolvedModel: string;

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
    this.#resolvedModel = profile.model;
  }

  get resolvedModel(): string {
    return this.#resolvedModel;
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
    } catch (error) {
      throw new Error(
        `OpenRouter returned non-JSON payload for ${request.role}`,
        { cause: error },
      );
    }

    return request.parse(parsed);
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
          responded_model: this.#resolvedModel,
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

      // OpenRouter reports the model that actually served the request, which can
      // differ from the requested model under routing/fallback. Capture it so
      // callers can persist the true model on the resulting event.
      const respondedModel =
        typeof payload?.model === "string" ? payload.model.trim() : "";
      if (respondedModel) {
        this.#resolvedModel = respondedModel;
      }

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

/**
 * Builds the provider a profile names. With `AI_CALL_LOG` set, every call it
 * makes is also appended to that file (see `ai-call-log.ts`).
 */
export function createAIProviderFromProfile(
  profile: AIRuntimeProfile,
  options: AIProviderFactoryOptions = {},
): AIProvider {
  const env = options.env ?? getRuntimeEnv();
  const provider = createProvider(profile, options, env);
  const callLog = env.AI_CALL_LOG?.trim();
  return callLog ? withCallLog(provider, callLog) : provider;
}

function createProvider(
  profile: AIRuntimeProfile,
  options: AIProviderFactoryOptions,
  env: Record<string, string | undefined>,
): AIProvider {
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

  if (profile.provider === "claude-cli") {
    return new ClaudeCliProvider(profile, resolveClaudeCliRuntimeConfig(env));
  }

  return new MockAIProvider(profile);
}
