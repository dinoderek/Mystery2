/**
 * Replays one case through a narrator binding: no server, no database.
 *
 * It rebuilds the real runtime prompt and context for the case's one action
 * from the fixed `given` state and explicit history (`prompt-build.ts`, which
 * shares the server handlers' assembly) and sends it through the core's model
 * runner. The input is fully specified by the case, not accumulated over
 * turns, so every model receives byte-identical input and the outputs compare
 * directly.
 *
 * A clue-graph accusation is three steps, chained as the game chains them
 * (`resolve-accuse.ts`): the narrator reports who was named and what was cited,
 * the engine decides from the graph, and the narrator words the reply the
 * engine chose, or the closing scene. Both calls go through the binding.
 */

import { runModel } from "../../core/runner.ts";
import { accusationRole, replyKindOf, resolves, settleAccusation } from "../../../packages/game-engine/src/clue-graph/accusation.ts";
import { playOf } from "../../../packages/game-engine/src/clue-graph/history.ts";
import { roleOutputJsonSchema, parseRoleOutput, parseGraphAccusationOutput, parseGraphAccusationRoundOutput, parseGraphEndingOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import type { ResolvedBinding } from "../../core/config.ts";
import type { ModelCall } from "../../core/result.ts";
import type {
  NarrationRoleInput,
  TemplateRoleInput,
} from "../../../packages/game-engine/src/role-request.ts";
import type { BlueprintLike, TurnCase } from "./case.ts";
import { buildNarrationMessages, buildNarrationPrompt, buildRoleRequest, resolveAccusationRole } from "./prompt-build.ts";
import { getAction, normalizeHistory } from "./roles.ts";
import { makeResponse } from "./transcript.ts";
import type { TurnResponse } from "./transcript.ts";

/** Narration roles reply with prose rather than a role-output JSON contract. */
const NARRATION_ROLES = new Set(["intro", "ambience"]);

export class NarratorReplayError extends Error {
  readonly calls: ModelCall[];
  readonly stage: "parser" | "admissibility" | "transport";
  constructor(message: string, calls: ModelCall[], stage: "parser" | "admissibility" | "transport") {
    super(message);
    this.calls = calls;
    this.stage = stage;
  }
}

function failedCall(message: string, calls: ModelCall[]): never {
  const outcome = calls.at(-1)?.attempts.at(-1)?.outcome;
  throw new NarratorReplayError(message, calls, outcome === "invalid" || outcome === "not_json" ? "parser" : "transport");
}

/** What a narrator source hands back for one case. */
export interface Collected {
  response: TurnResponse;
  /** The model behind the narration, as the stored turn records it. */
  model: string;
  /** The narrator's calls through the runner, in order; none when the harness made none. */
  calls: ModelCall[];
}

export interface CliReplayRequest {
  testCase: TurnCase;
  blueprint: BlueprintLike;
  binding: ResolvedBinding;
  logDir: string;
}

/** What the provider sends for each shape of role (see `OpenRouterProvider.generateNarration` and `generateRoleOutput`). */
async function composeRequest(testCase: TurnCase, blueprint: BlueprintLike) {
  const action = getAction(testCase.action.type);
  const history = normalizeHistory(testCase.given.history);
  const roleInput = action.roleInput(testCase.given, testCase.action, blueprint, history);
  if (NARRATION_ROLES.has(roleInput.role)) {
    const prompt = buildNarrationPrompt(roleInput as unknown as NarrationRoleInput);
    return { request: { ...buildNarrationMessages(prompt), prompt, context: null, role: null }, narration: true } as const;
  }
  return { request: await buildRoleRequest(roleInput as unknown as TemplateRoleInput), narration: false } as const;
}

export function modelLabel(binding: ResolvedBinding): string {
  return `${binding.name}${binding.model ? `:${binding.model}` : ""}`;
}

export async function replayThroughNarrator(replay: CliReplayRequest): Promise<Collected> {
  const { testCase, blueprint, binding, logDir } = replay;
  if (testCase.action.type === "accuse" && resolveAccusationRole(testCase.action.player_reasoning) === "accusation_judge") return replayGraphAccusation(replay);
  const action = getAction(testCase.action.type);
  const { request, narration } = await composeRequest(testCase, blueprint);

  const result = await runModel({
    binding,
    step: `narrate-${testCase.id}-${testCase.action.type}`,
    systemPrompt: request.system,
    userMessage: request.user,
    logDir,
    env: { EVAL_OUTPUT_FORMAT: narration ? "text" : "json" },
    answerSchema: narration ? undefined : roleOutputJsonSchema(request.role!),
    // Prose is not JSON, so a narration role is read as text when the wrapper
    // prints it bare; a wrapper that prints an envelope names where the text is.
    output: narration && binding.extract_path === null ? "text" : "json",
    // Validated inside the retry loop: prose where JSON was asked for is a retriable failure.
    parse: narration ? (answer) => {
      if (!answer.trim()) throw new Error("Narrator returned empty prose");
      return { narration: answer.trim() };
    } : (answer) => {
      const value = JSON.parse(answer);
      // The live greeting always counts as understood, before its normal parser.
      const greeting = request.role === "graph_talk" && testCase.action.type === "talk";
      return parseRoleOutput(request.role!, greeting && typeof value === "object" && value !== null ? { ...value, input_understood: true } : value);
    },
  });
  if (!result.ok) failedCall(`narrator ${testCase.action.type} failed: ${result.error}`, [result.call]);

  // Narration roles reply with prose; role-output roles reply with JSON whose
  // `narration` field carries the text.
  const roleOutput = result.value as Record<string, unknown>;
  const text = typeof roleOutput.narration === "string" ? roleOutput.narration : "";
  const speaker = action.speaker(testCase.given, testCase.action, blueprint);

  const response = makeResponse({
    action: testCase.action.type,
    request: { ...testCase.action },
    parts: text ? [{ text, speaker }] : [],
    prompt: request.prompt,
    raw: roleOutput,
    outputRole: request.role ?? undefined,
  });
  return { response, model: modelLabel(binding), calls: [result.call] };
}

/**
 * The report, the engine's decision and the reply. A report the game would
 * refuse (an accused the case does not hold) is a retriable failure, as the
 * game retries it. `raw` holds what the game saves of the turn: the role that
 * narrated, the decided accusation and, on a failure, the kind of reply.
 */
async function replayGraphAccusation({ testCase, blueprint, binding, logDir }: CliReplayRequest): Promise<Collected> {
  const graph = blueprint.clue_graph;
  const action = getAction("accuse");
  const history = normalizeHistory(testCase.given.history);
  const roleInput = action.roleInput(testCase.given, testCase.action, blueprint, history);
  if (roleInput.role !== "graph_accusation") throw new Error(`a clue-graph accusation case needs player_reasoning, not the ${roleInput.role} scene`);
  const judge = await buildRoleRequest(roleInput as unknown as TemplateRoleInput);
  const reported = await runModel({
    binding,
    step: `narrate-${testCase.id}-accuse-report`,
    systemPrompt: judge.system,
    userMessage: judge.user,
    logDir,
    output: "json",
    answerSchema: roleOutputJsonSchema("graph_accusation"),
    parse: (answer) => parseGraphAccusationOutput(JSON.parse(answer)) as unknown as Record<string, unknown>,
  });
  if (!reported.ok) failedCall(`narrator accuse report failed: ${reported.error}`, [reported.call]);
  const report = reported.value as unknown as ReturnType<typeof parseGraphAccusationOutput>;

  if (report.accused_character_id !== null && !Object.hasOwn(graph.characters, report.accused_character_id)) {
    throw new NarratorReplayError(`accused_character_id "${report.accused_character_id}" is not in the case`, [reported.call], "admissibility");
  }
  const { saved } = settleAccusation(graph, playOf(graph, history), history, { accused: report.accused_character_id, cited: report.cited_clue_ids });
  const ended = resolves(saved.verdict);
  const role = accusationRole(saved.verdict);
  const reply = await buildRoleRequest({
    ...(roleInput as unknown as Extract<TemplateRoleInput, { role: "graph_accusation" }>),
    role,
    verdict: saved.verdict,
    accused: saved.accused,
    cited: saved.cited,
  } as TemplateRoleInput);
  const worded = await runModel({
    binding,
    step: `narrate-${testCase.id}-accuse-reply`,
    systemPrompt: reply.system,
    userMessage: reply.user,
    logDir,
    output: "json",
    answerSchema: roleOutputJsonSchema(role),
    parse: (answer) => (ended ? parseGraphEndingOutput : parseGraphAccusationRoundOutput)(JSON.parse(answer)) as unknown as Record<string, unknown>,
  });
  if (!worded.ok) failedCall(`narrator accuse reply failed: ${worded.error}`, [reported.call, worded.call]);

  const narration = String(worded.value!.narration);
  const replyKind = ended ? null : replyKindOf(reply.context as { graph_accusation_context?: unknown });
  const response = makeResponse({
    action: "accuse",
    request: { ...testCase.action },
    parts: [{ text: narration, speaker: action.speaker(testCase.given, testCase.action, blueprint) }],
    prompt: `${judge.prompt}\n\n${reply.prompt}`,
    raw: { role, narration, report, clue_graph_accusation: saved, ...(ended ? {} : { reply_kind: replyKind }) },
    outputRole: role,
  });
  return { response, model: modelLabel(binding), calls: [reported.call, worded.call] };
}
