import type { AIRoleName } from "./ai-contracts.ts";
import { withCallLog } from "./ai-call-log.ts";
import { readArrivalPrompt, readOpeningFacts } from "./ai-prompts.ts";
import {
  ClaudeCliProvider,
  type ClaudeCliRuntimeConfig,
} from "./ai-provider-claude-cli.ts";
import { RetriableAIError } from "./errors.ts";
import type { GraphSearchContext, GraphTalkContext } from "./clue-graph/narrator-context.ts";
import type { GraphAccusationContext, GraphVerdictContext } from "./clue-graph/accusation.ts";
import type { NamedSpot, Rider } from "./clue-graph/talk-state.ts";

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

/** A clue as the mock words it: the fact as given, and a pointer's spot named. */
function mockWording(text: string, spot?: NamedSpot): string {
  return spot ? `${text} (That points to ${spot.spot} in ${spot.location}.)` : text;
}

/** Words too common, in a mock line, to show that the investigator cited it. */
const MOCK_PLAIN_WORDS = new Set(["says", "said", "that", "this", "with", "they", "there", "were", "from", "have", "when", "what", "then", "mock"]);

function mockWords(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
}

/**
 * The mock's reading of an accusation: the person named earliest in the line,
 * and the held clues the investigator cited: named by ID, or sharing two
 * telling words with the clue's line.
 */
function mockGraphAccusation(context: GraphAccusationContext, playerInput: string): Record<string, unknown> {
  const line = playerInput.toLowerCase();
  const nameWords = (name: string) => name.toLowerCase().match(/[a-z]{3,}/g)?.filter((word) => !["mrs", "miss"].includes(word)) ?? [];
  const named = context.people
    .map((person) => ({
      id: person.id,
      at: Math.min(...nameWords(person.name).map((word) => line.search(new RegExp(`\\b${word}\\b`))).filter((at) => at >= 0)),
    }))
    .filter((person) => Number.isFinite(person.at))
    .sort((a, b) => a.at - b.at);
  const names = new Set(context.people.flatMap((person) => nameWords(person.name)));
  const said = playerInput;
  const saidWords = mockWords(said);
  const cited = context.held
    .filter((entry) => {
      if (said.toLowerCase().includes(entry.id.toLowerCase())) return true;
      const shared = [...mockWords(entry.text)].filter((word) => saidWords.has(word) && !names.has(word) && !MOCK_PLAIN_WORDS.has(word));
      return shared.length >= 2;
    })
    .map((entry) => entry.id);
  return { accused_character_id: named[0]?.id ?? null, cited_clue_ids: cited };
}

/** The mock's wording of what the engine decided: a failed accusation, or the whole account at the end. */
function mockGraphVerdict(context: GraphVerdictContext, turnsSpent = false): string {
  if (context.ending) {
    const { outcome, culprit, what_happened, timeline, motive } = context.ending;
    const opening = outcome === "win" ? "You solved it!" : "The case ends here. This time the answer got away.";
    return `[Mock] ${opening} ${culprit} did it. ${what_happened} ${timeline.join(" ")} Why: ${motive}`;
  }
  const reply = context.reply;
  if (!reply) throw new Error("Mock AI failed accusation requires reply material");
  const close = turnsSpent ? "Try your accusation again." : "What could you check next?";
  if (reply.kind === "flaw") {
    const flaw = "cleared_by" in reply
      ? `These clues conflict with that case: ${reply.cleared_by.map((entry) => entry.text).join(" ")}`
      : reply.retracted.map(({ statement, taken_back_by }) => `${taken_back_by} took back this statement: ${statement.text}`).join(" ");
    return `[Mock] Not proven yet. ${flaw} ${close}`;
  }
  const explanation = reply.kind === "alternative"
    ? `Those clues also fit ${reply.people.map((person) => person.name).join(" and ")}; they do not settle who did it.`
    : `Your case needs ${reply.fact_kind}.`;
  return `[Mock] Not proven yet. ${explanation} ${reply.lead ? `Think about this: ${reply.lead} ` : ""}${close}`;
}

/** The mock's notebook line for a clue: its wording, marked as the narrator's, so a test can tell it from the fact. */
export function mockNotebookLine(text: string, spot?: NamedSpot): string {
  return `[Mock] ${mockWording(text, spot)}`;
}

/** A clue that comes out on a mock line: said, or (for a tell) seen, which the narration puts in brackets. */
interface MockEntry {
  id: string;
  text: string;
  seen?: true;
  names_spot?: NamedSpot;
}

function entryAndRiders(id: string, text: string, spot: NamedSpot | undefined, riders: Rider[]): MockEntry[] {
  return [
    { id, text, ...(spot ? { names_spot: spot } : {}) },
    ...riders.map((rider): MockEntry => ({ id: rider.id, text: rider.does, seen: true, ...(rider.names_spot ? { names_spot: rider.names_spot } : {}) })),
  ];
}

function mockSaid(entries: MockEntry[]): { said: string[]; notebook: Array<{ id: string; line: string }> } {
  return {
    said: entries.map((entry) => {
      const worded = mockWording(entry.text, entry.names_spot);
      return entry.seen ? `(${worded})` : worded;
    }),
    notebook: entries.map((entry) => ({ id: entry.id, line: mockNotebookLine(entry.text, entry.names_spot) })),
  };
}

/**
 * The mock's clue-graph talk line, as the live narrator is asked to judge it
 * (`clue-graph/prompts.ts`), from the words alone: a question about an answer's
 * "about" answers it; naming a subject shows its tell; a gate opens when the
 * line names its show clues (held, or any clue for a bluffable gate), names the
 * gate's own id for a worded line, or asks for "the truth" when it is asked
 * plainly. A line with "know" in it shares what the character knows; a line
 * that earns and shares nothing gets a plain "I don't know". Every clue that
 * comes out gets its notebook line; a first meeting shows how they look.
 */
export function mockGraphTalk(context: GraphTalkContext, playerInput: string | null): Record<string, unknown> {
  const { character, state } = context;
  const firstWords = state.says_first.flatMap((entry) => entryAndRiders(entry.id, entry.says, entry.names_spot, entry.with));
  if (playerInput === null) {
    const { said, notebook } = mockSaid(firstWords);
    const looks = character.appearance ? ` ${character.appearance.join(" ")}` : "";
    const greeting = said.length > 0 ? ` ${character.name} says: ${said.join(" ")}` : "";
    return {
      narration: `[Mock] ${character.name} is here in ${context.location_name}.${looks}${greeting}`,
      opened: [],
      answered: [],
      notebook,
      input_understood: true,
    };
  }
  if (looksUnintelligible(playerInput)) {
    return { narration: `[Mock] ${character.name} blinked. "Sorry — what?"`, opened: [], answered: [], notebook: [], input_understood: false };
  }
  const line = playerInput.toLowerCase();
  const names = (text: string) => line.includes(text.toLowerCase());
  const answers = state.answers_if_asked.filter((entry) => names(entry.about));
  const tells = state.shows_when.filter((entry) => names(entry.subject));
  const gates = state.gates.filter((gate) => {
    const { show, line: worded, asked_plainly } = gate.opens_with;
    if (asked_plainly) return /\btruth\b/.test(line);
    if (worded && names(gate.id)) return true;
    if (!show) return false;
    const usable = show.clues.filter((clue) => names(clue.id) && (clue.held || gate.bluffable));
    return show.match === "all" ? usable.length === show.clues.length : usable.length > 0;
  });
  const { said, notebook } = mockSaid([
    ...firstWords,
    ...answers.flatMap((entry) => entryAndRiders(entry.id, entry.says, entry.names_spot, entry.with)),
    ...tells.map((entry): MockEntry => ({ id: entry.id, text: entry.does, seen: true, ...(entry.names_spot ? { names_spot: entry.names_spot } : {}) })),
    ...gates.flatMap((gate) => entryAndRiders(gate.id, gate.says, gate.names_spot, gate.with)),
  ]);
  const shared = /\bknow\b/.test(line) ? character.knows.map((known) => known.fact) : [];
  const spoken = [...said, ...shared];
  return {
    narration: spoken.length > 0
      ? `[Mock] ${character.name} says: ${spoken.join(" ")}`
      : `[Mock] ${character.name} says: "I don't know."`,
    opened: gates.map((gate) => gate.id),
    answered: [...answers, ...tells].map((entry) => entry.id),
    notebook,
    input_understood: true,
  };
}

/** The mock's clue-graph search: a known outcome as given; a judged one finds nothing. */
export function mockGraphSearch(context: GraphSearchContext): Record<string, unknown> {
  const place = context.location_name;
  if (context.search_query && looksUnintelligible(context.search_query)) {
    return {
      narration: `[Mock] You poke around ${place}, but you're not sure what you're even looking for.`,
      revealed_clue_id: null,
      costs_turn: false,
      input_understood: false,
      notebook: [],
    };
  }
  const { outcome } = context;
  const where = outcome.kind === "known" && outcome.spot ? `${outcome.spot} in ${place}` : place;
  const found = outcome.kind === "known" ? outcome.finds : null;
  return {
    narration: found
      ? `[Mock] You search ${where} and uncover a clue: ${mockWording(found.text, found.names_spot)}`
      : `[Mock] You search ${where}, but find nothing new.`,
    revealed_clue_id: found?.id ?? null,
    costs_turn: true,
    input_understood: true,
    notebook: found ? [{ id: found.id, line: mockNotebookLine(found.text, found.names_spot) }] : [],
  };
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
    // An arrival names the place, states its facts as given, and names who is
    // there: names only, so nothing else about them reaches the transcript.
    const arrival = readArrivalPrompt(prompt);
    if (arrival) {
      const facts = arrival.facts ? ` ${arrival.facts.join(" ")}` : "";
      const present = arrival.character_names.map((name) => ` ${name} is here.`).join("");
      return `[Mock] You arrive at ${arrival.destination_name}.${facts}${present}`;
    }
    // An opening states its facts, as given.
    const opening = readOpeningFacts(prompt);
    if (opening) return `[Mock] ${opening.join(" ")}`;
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
      case "graph_talk": {
        const graphTalk = context.graph_talk_context as GraphTalkContext | undefined;
        if (!graphTalk) throw new Error("Mock AI graph_talk requires graph_talk_context");
        return mockGraphTalk(graphTalk, readOptionalContextString(context, "player_input"));
      }
      case "graph_search": {
        const graphSearch = context.graph_search_context as GraphSearchContext | undefined;
        if (!graphSearch) throw new Error("Mock AI graph_search requires graph_search_context");
        return mockGraphSearch(graphSearch);
      }
      case "graph_accusation": {
        const accusation = context.graph_accusation_context as GraphAccusationContext | undefined;
        if (!accusation) throw new Error("Mock AI graph_accusation requires graph_accusation_context");
        return mockGraphAccusation(accusation, readOptionalContextString(context, "player_input") ?? "");
      }
      case "graph_accusation_round":
      case "graph_ending": {
        const verdict = context.graph_accusation_context as GraphVerdictContext | undefined;
        if (!verdict) throw new Error(`Mock AI ${role} requires graph_accusation_context`);
        return { narration: mockGraphVerdict(verdict, context.forced_by_timeout === true) };
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
      default:
        throw new Error(`Mock AI has no handler for role ${String(role)}`);
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
