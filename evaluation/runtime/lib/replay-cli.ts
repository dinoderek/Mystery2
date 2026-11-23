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
import { parseGraphAccusationOutput, parseGraphAccusationRoundOutput, parseGraphEndingOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import type { ResolvedBinding } from "../../core/config.ts";
import type { ModelCall } from "../../core/result.ts";
import type {
  NarrationRoleInput,
  TemplateRoleInput,
} from "../../../packages/game-engine/src/role-request.ts";
import type { BlueprintLike, TurnCase } from "./case.ts";
import { parseFencedJson } from "./model-json.ts";
import { buildNarrationPrompt, buildRoleRequest } from "./prompt-build.ts";
import type { ModelRequest } from "./prompt-build.ts";
import { getAction, normalizeHistory } from "./roles.ts";
import { makeResponse } from "./transcript.ts";
import type { TurnResponse } from "./transcript.ts";

/** Narration roles reply with prose rather than a role-output JSON contract. */
const NARRATION_ROLES = new Set(["intro", "ambience"]);

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
async function composeRequest(testCase: TurnCase, blueprint: BlueprintLike): Promise<{ request: ModelRequest; narration: boolean }> {
  const action = getAction(testCase.action.type);
  const history = normalizeHistory(testCase.given.history);
  const roleInput = action.roleInput(testCase.given, testCase.action, blueprint, history);
  if (NARRATION_ROLES.has(roleInput.role)) {
    const prompt = buildNarrationPrompt(roleInput as unknown as NarrationRoleInput);
    const system = "You are the narrator for a kids mystery game. Return plain text only.";
    return { request: { system, user: prompt, prompt, context: null }, narration: true };
  }
  return { request: await buildRoleRequest(roleInput as unknown as TemplateRoleInput), narration: false };
}

export function modelLabel(binding: ResolvedBinding): string {
  return `${binding.name}${binding.model ? `:${binding.model}` : ""}`;
}

export async function replayThroughNarrator(replay: CliReplayRequest): Promise<Collected> {
  const { testCase, blueprint, binding, logDir } = replay;
  if (testCase.action.type === "accuse") return replayGraphAccusation(replay);
  const action = getAction(testCase.action.type);
  const { request, narration } = await composeRequest(testCase, blueprint);

  const result = await runModel({
    binding,
    step: `narrate-${testCase.id}-${testCase.action.type}`,
    systemPrompt: request.system,
    userMessage: request.user,
    logDir,
    // Prose is not JSON, so a narration role is read as text when the wrapper
    // prints it bare; a wrapper that prints an envelope names where the text is.
    output: narration && binding.extract_path === null ? "text" : "json",
    // Validated inside the retry loop: prose where JSON was asked for is a retriable failure.
    parse: narration ? undefined : (answer) => parseFencedJson(answer) as Record<string, unknown>,
  });
  if (!result.ok) throw new Error(`narrator ${testCase.action.type} failed: ${result.error}`);

  // Narration roles reply with prose; role-output roles reply with JSON whose
  // `narration` field carries the text.
  const roleOutput = narration ? { narration: result.answer } : (result.value as Record<string, unknown>);
  const text = typeof roleOutput.narration === "string" ? roleOutput.narration : "";
  const speaker = action.speaker(testCase.given, testCase.action, blueprint);

  const response = makeResponse({
    action: testCase.action.type,
    request: { ...testCase.action },
    parts: text ? [{ text, speaker }] : [],
    prompt: request.prompt,
    raw: roleOutput,
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
    parse: (answer) => {
      const report = parseGraphAccusationOutput(parseFencedJson(answer));
      const accused = report.accused_character_id;
      if (accused !== null && !Object.hasOwn(graph.characters, accused)) throw new Error(`accused_character_id "${accused}" is not in the case`);
      return report as unknown as Record<string, unknown>;
    },
  });
  if (!reported.ok) throw new Error(`narrator accuse report failed: ${reported.error}`);
  const report = reported.value as unknown as ReturnType<typeof parseGraphAccusationOutput>;

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
    parse: (answer) => (ended ? parseGraphEndingOutput : parseGraphAccusationRoundOutput)(parseFencedJson(answer)) as unknown as Record<string, unknown>,
  });
  if (!worded.ok) throw new Error(`narrator accuse reply failed: ${worded.error}`);

  const narration = String(worded.value!.narration);
  const replyKind = ended ? null : replyKindOf(reply.context as { graph_accusation_context?: unknown });
  const response = makeResponse({
    action: "accuse",
    request: { ...testCase.action },
    parts: [{ text: narration, speaker: action.speaker(testCase.given, testCase.action, blueprint) }],
    prompt: `${judge.prompt}\n\n${reply.prompt}`,
    raw: { role, narration, report, clue_graph_accusation: saved, ...(ended ? {} : { reply_kind: replyKind }) },
  });
  return { response, model: modelLabel(binding), calls: [reported.call, worded.call] };
}
