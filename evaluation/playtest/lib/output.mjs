// A played game, written out for a person to read and for tools to reuse.
//
//   transcript.md   the game as read: inputs with the investigator's plan,
//                   narration, the game's hints and errors, then a summary
//   script.json     the investigator's inputs in order, each with a checkpoint
//                   of the game before it, for replay (./replay.mjs)
//   steps.jsonl     one line per step: view shown, input, action, response
//   ai-calls.jsonl  this game's narrator calls, when the server logged them
//   summary.json    outcome and counts

import fs from "node:fs";
import path from "node:path";

import { renderEntry } from "./view.mjs";

/** Every clue a blueprint defines: at locations, sub-locations and characters. */
export function countBlueprintClues(blueprint) {
  let total = 0;
  for (const location of blueprint.world.locations) {
    total += location.clues?.length ?? 0;
    for (const sub of location.sub_locations ?? []) total += sub.clues?.length ?? 0;
  }
  for (const character of blueprint.world.characters) total += character.clues?.length ?? 0;
  return total;
}

function readCallLog(file, gameId) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.game_id === gameId);
}

function sum(values) {
  return values.reduce((total, value) => total + (typeof value === "number" ? value : 0), 0);
}

export function summarizeGame({
  game,
  blueprint,
  persona,
  narratorModel,
  investigatorModel,
  calls,
  wallMs,
  replay = null,
}) {
  const found = game.finalState.discovered_clues ?? [];
  return {
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
    parser_rejections: game.steps.filter((step) => step.action.kind === "feedback").length,
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

function renderTranscript(game, summary) {
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

function describeDivergence({ step, input, differences }) {
  const fields = Object.entries(differences)
    .map(([field, { expected, actual }]) =>
      `${field} was ${JSON.stringify(expected)}, now ${JSON.stringify(actual)}`
    )
    .join("; ");
  return `before step ${step} (\`${input}\`): ${fields}`;
}

function formatCost(value) {
  return value === null ? "n/a" : `$${value.toFixed(3)}`;
}

/**
 * Writes one game's folder and returns its summary. `replay` is
 * { of: <script path>, clueDrift } when the game replayed a script.
 */
export function writeGameFolder({
  dir,
  game,
  blueprint,
  persona,
  narratorModel,
  investigatorModel,
  callLogFile,
  wallMs,
  replay = null,
}) {
  fs.mkdirSync(dir, { recursive: true });
  const calls = readCallLog(callLogFile, game.gameId);
  const summary = summarizeGame({
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
      { blueprint_id: blueprint.id, persona, inputs: game.script, checkpoints: game.checkpoints },
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
  fs.writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
