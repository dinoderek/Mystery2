// A played game, written out for a person to read and for tools to reuse.
//
//   transcript.md   the game as read: inputs with the investigator's plan,
//                   narration, the game's hints and errors, then a summary
//   script.json     the investigator's inputs in order, each with a checkpoint
//                   of the game before it, for replay (./replay.mjs)
//   steps.jsonl     one line per step: view shown, input, action, response
//   ai-calls.jsonl  this game's narrator calls, when the server logged them
//   events.json     the events the game saved, for the report
//   summary.json    outcome and counts

import fs from "node:fs";
import path from "node:path";

import type { PlayedEvent } from "./database.ts";
import type { PlayedGame } from "./game.ts";
import type { Divergence } from "./investigator.ts";
import { renderEntry } from "./view.ts";

type Clues = { clues?: unknown[] };

/** The parts of a blueprint a game's folder reads. */
export interface PlaytestBlueprint {
  id: string;
  metadata: { title: string; time_budget: number; target_age?: number };
  world: {
    locations: Array<Clues & { sub_locations?: Clues[] }>;
    characters: Clues[];
  };
}

/** A replay's source, and where it first found different clues. */
export interface ReplayInfo {
  of: string;
  clueDrift: { step: number; input: string; expected: string[]; actual: string[] } | null;
}

/** One narrator call the server logged. */
interface NarratorCall {
  game_id?: string;
  cost_usd?: number | null;
}

/** `summary.json`: how one game went. `grades` is added when the game is judged. */
export interface GameSummary {
  /** Its place among the run's games, as the run's progress lines number it; null outside a run. */
  game_number: number | null;
  game_id: string;
  blueprint: { id: string; title: string };
  persona: string;
  narrator_model: string;
  investigator_model: string;
  outcome: "win" | "lose" | null;
  stop_reason: string;
  error: string | null;
  replay_of: string | null;
  divergence: Divergence | null;
  clue_drift: ReplayInfo["clueDrift"];
  final_mode: string;
  steps: number;
  turns_used: number;
  time_budget: number;
  parser_rejections: number;
  failed_calls: number;
  clues_found: number;
  clues_total: number;
  clue_ids_found: string[];
  narrator_calls: number;
  narrator_cost_usd: number | null;
  investigator_cost_usd: number | null;
  wall_seconds: number;
  grades?: unknown;
}

/** Every clue a blueprint defines: at locations, sub-locations and characters. */
export function countBlueprintClues(blueprint: PlaytestBlueprint): number {
  let total = 0;
  for (const location of blueprint.world.locations) {
    total += location.clues?.length ?? 0;
    for (const sub of location.sub_locations ?? []) total += sub.clues?.length ?? 0;
  }
  for (const character of blueprint.world.characters) total += character.clues?.length ?? 0;
  return total;
}

function readCallLog(file: string | null, gameId: string): NarratorCall[] {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NarratorCall)
    .filter((entry) => entry.game_id === gameId);
}

function sum(values: unknown[]): number {
  return values.reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);
}

interface GameFolderInput {
  /** Which of the run's games this is. */
  number?: number;
  game: PlayedGame;
  blueprint: PlaytestBlueprint;
  persona: string;
  narratorModel: string;
  investigatorModel: string;
  wallMs: number;
  replay?: ReplayInfo | null;
}

export function summarizeGame({
  number,
  game,
  blueprint,
  persona,
  narratorModel,
  investigatorModel,
  calls,
  wallMs,
  replay = null,
}: GameFolderInput & { calls: NarratorCall[] }): GameSummary {
  const found = game.finalState.discovered_clues ?? [];
  return {
    game_number: number ?? null,
    game_id: game.gameId,
    blueprint: { id: blueprint.id, title: blueprint.metadata.title },
    persona,
    narrator_model: narratorModel,
    investigator_model: investigatorModel,
    outcome: game.result ?? null,
    stop_reason: game.stopReason,
    error: game.error ?? null,
    replay_of: replay?.of ?? null,
    divergence: game.divergence ?? null,
    clue_drift: replay?.clueDrift ?? null,
    final_mode: game.finalState.mode,
    steps: game.steps.length,
    turns_used: blueprint.metadata.time_budget - game.finalState.time_remaining,
    time_budget: blueprint.metadata.time_budget,
    parser_rejections: game.steps.filter((step) => step.action.kind === "refused" || step.action.kind === "view").length,
    failed_calls: game.steps.filter((step) => step.response && !step.response.ok).length,
    clues_found: found.length,
    clues_total: countBlueprintClues(blueprint),
    clue_ids_found: found.map((clue) => clue.id),
    narrator_calls: calls.length,
    narrator_cost_usd: calls.length > 0 ? sum(calls.map((call) => call.cost_usd)) : null,
    investigator_cost_usd: game.steps.some((step) => step.investigator.cost_usd !== null)
      ? sum(game.steps.map((step) => step.investigator.cost_usd))
      : null,
    wall_seconds: Math.round(wallMs / 1000),
  };
}

function renderTranscript(game: PlayedGame, summary: GameSummary): string {
  const lines = [
    `# ${summary.blueprint.title}: ${summary.persona}`,
    "",
    `Game \`${summary.game_id}\`. Narrator ${summary.narrator_model}, investigator ${summary.investigator_model}.`,
    ...(summary.replay_of ? ["", `Replay of \`${summary.replay_of}\`.`] : []),
    "",
  ];

  for (const entry of game.transcript) {
    if (entry.kind === "input") {
      lines.push("");
      if (entry.plan) lines.push(`*(${entry.plan})*`);
      lines.push(`**> ${entry.text}**`);
    } else {
      lines.push("", renderEntry(entry));
    }
  }

  lines.push(
    "",
    "---",
    "",
    `- Outcome: ${summary.outcome ?? "none"} (stopped: ${summary.stop_reason})`,
    ...(summary.error ? [`- Error: ${summary.error}`] : []),
    ...(summary.divergence ? [`- Diverged: ${describeDivergence(summary.divergence)}`] : []),
    ...(summary.clue_drift
      ? [`- Clues first differed before step ${summary.clue_drift.step} (\`${summary.clue_drift.input}\`)`]
      : []),
    `- Turns used: ${summary.turns_used} of ${summary.time_budget}; steps: ${summary.steps}` +
      ` (${summary.parser_rejections} not understood by the parser, ${summary.failed_calls} failed calls)`,
    `- Clues found: ${summary.clues_found} of ${summary.clues_total}`,
    `- Cost: narrator ${formatCost(summary.narrator_cost_usd)}, investigator ${formatCost(summary.investigator_cost_usd)}`,
    `- Wall time: ${summary.wall_seconds}s`,
    "",
  );
  return lines.join("\n");
}

function describeDivergence({ step, input, differences }: Divergence): string {
  const fields = Object.entries(differences)
    .map(([field, { expected, actual }]) =>
      `${field} was ${JSON.stringify(expected)}, now ${JSON.stringify(actual)}`
    )
    .join("; ");
  const where = input === null ? "after the last input" : `before step ${step} (\`${input}\`)`;
  return `${where}: ${fields}`;
}

function formatCost(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(3)}`;
}

/**
 * Writes one game's folder and returns its summary. `replay` is
 * { of: <script path>, clueDrift } when the game replayed a script; `events`
 * are the events the game saved, for the report.
 */
export function writeGameFolder({
  dir,
  number,
  game,
  blueprint,
  persona,
  narratorModel,
  investigatorModel,
  callLogFile,
  wallMs,
  replay = null,
  events = null,
}: GameFolderInput & { dir: string; callLogFile: string | null; events?: PlayedEvent[] | null }): GameSummary {
  fs.mkdirSync(dir, { recursive: true });
  const calls = readCallLog(callLogFile, game.gameId);
  const summary = summarizeGame({
    number,
    game,
    blueprint,
    persona,
    narratorModel,
    investigatorModel,
    calls,
    wallMs,
    replay,
  });

  fs.writeFileSync(path.join(dir, "transcript.md"), renderTranscript(game, summary));
  fs.writeFileSync(
    path.join(dir, "script.json"),
    `${JSON.stringify(
      {
        blueprint_id: blueprint.id,
        persona,
        inputs: game.script,
        checkpoints: game.checkpoints,
        end: game.endCheckpoint,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "steps.jsonl"),
    game.steps.map((step) => JSON.stringify(step)).join("\n") + "\n",
  );
  if (calls.length > 0) {
    fs.writeFileSync(
      path.join(dir, "ai-calls.jsonl"),
      calls.map((call) => JSON.stringify(call)).join("\n") + "\n",
    );
  }
  if (events) fs.writeFileSync(path.join(dir, "events.json"), `${JSON.stringify(events, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
