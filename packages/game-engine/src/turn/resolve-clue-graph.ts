// A clue-graph case's talk and search turns (`docs/clue-graph.md`). The engine
// derives what can come out from the graph and the events; the narrator plays
// it, reports what a line earned, and writes a notebook line for every clue
// that comes out. A report the state did not offer, or lines that are not
// exactly the clues that come out, fail the turn before anything is saved.
// Each turn that counts saves its `ClueGraphEvent`, lines included, in
// `payload.clue_graph`, the record the play is folded from.

import type { RevealedClue } from "../../../shared/src/mystery-api-contracts.ts";
import type { ClueGraphCase } from "../../../shared/src/clue-graph-schema.ts";
import { parseGraphSearchOutput, parseGraphTalkOutput, type NotebookLine } from "../ai-contracts.ts";
import { playOf } from "../clue-graph/history.ts";
import { resolveGraphSearchWords } from "../clue-graph/narrator-context.ts";
import {
  applyEvent,
  lineOf,
  ridersOf,
  type ClueGraphEvent,
  type ClueGraphPlay,
  type ClueGraphStep,
  type NotebookLines,
} from "../clue-graph/play.ts";
import { talkState } from "../clue-graph/talk-state.ts";
import { RequestRejectedError } from "../errors.ts";
import { createNarrationPart } from "../narration.ts";
import { buildRoleRequest } from "../role-request.ts";
import { createCharacterSpeaker, NARRATOR_SPEAKER } from "../speaker.ts";
import { askRole, rejectOutput } from "./narrator.ts";
import type { ActionOutcome, TurnGame, TurnRuntime } from "./types.ts";

function graphOf(game: TurnGame): ClueGraphCase {
  return game.blueprint.clue_graph;
}

/** The notebook records of the clues a turn brought out, each as its saved line. */
function recordsFor(game: TurnGame, step: ClueGraphStep): RevealedClue[] {
  const graph = graphOf(game);
  const at = new Date().toISOString();
  return step.revealed.map((id) => {
    const clue = graph.clues[id];
    const origin =
      clue.kind === "evidence"
        ? { kind: "location" as const, location_id: clue.source.location, location_name: graph.locations[clue.source.location].name }
        : { kind: "character" as const, character_id: clue.source.character, character_name: graph.characters[clue.source.character].name };
    return {
      id,
      text: lineOf(graph, step.play, id),
      source: clue.kind === "evidence" ? ("search" as const) : ("talk" as const),
      origin,
      discovered_at: at,
      off_script: false,
    };
  });
}

/**
 * The event with the narrator's notebook lines, and its fold. The lines must be
 * exactly the clues the event brings out, each once: a missing or extra line
 * fails the turn. A line for a clue the player already holds, which the
 * narrator restated, is dropped, as a repeated report is.
 */
function withNotebook<E extends Exclude<ClueGraphEvent, { type: "move" }>>(
  game: TurnGame,
  runtime: TurnRuntime,
  play: ClueGraphPlay,
  event: E,
  reply: { action: string; lines: NotebookLine[] },
): { event: E; step: ClueGraphStep } {
  const { action, lines } = reply;
  const graph = graphOf(game);
  const revealed = applyEvent(graph, play, event).revealed;
  const notebook: NotebookLines = {};
  const extra: string[] = [];
  const twice: string[] = [];
  const restated: string[] = [];
  for (const { id, line } of lines) {
    if (Object.hasOwn(notebook, id)) twice.push(id);
    else if (revealed.includes(id)) notebook[id] = line;
    else if (play.held.includes(id)) restated.push(id);
    else extra.push(id);
  }
  const missing = revealed.filter((id) => !Object.hasOwn(notebook, id));
  if (missing.length > 0 || extra.length > 0 || twice.length > 0) {
    rejectOutput(runtime, action, "Clue-graph notebook lines are not the clues the turn brings out", {
      expected_clue_ids: revealed,
      missing_clue_ids: missing,
      extra_clue_ids: extra,
      repeated_clue_ids: twice,
    });
  }
  if (restated.length > 0) {
    runtime.logger.log("notebook.line_for_held_clue", { game_id: game.game_id, action, clue_ids: restated });
  }
  const recorded = revealed.length > 0 ? { ...event, notebook } : event;
  return { event: recorded, step: applyEvent(graph, play, recorded) };
}

function discoveredAfter(game: TurnGame, kept: string[]): string[] {
  return [...new Set([...game.session.discovered_clues, ...kept])];
}

export async function resolveGraphTalk(game: TurnGame, runtime: TurnRuntime, characterId: string): Promise<ActionOutcome> {
  const { session } = game;
  const graph = graphOf(game);
  const character = game.blueprint.world.characters.find(
    (entry) => entry.id === characterId && entry.location_id === session.current_location_id,
  );
  if (!character) {
    throw new RequestRejectedError(400, `Character ${characterId} not found in current location`, "character_not_found_in_location");
  }
  const play = playOf(graph, game.history);
  const talk = { type: "talk" as const, character: character.id };
  const greeted = applyEvent(graph, play, talk);

  const { prompt, context } = await buildRoleRequest({
    role: "graph_talk",
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    reading_age: game.reading_age,
    character_id: character.id,
    location_id: session.current_location_id,
    player_input: null,
    conversation_history: game.history,
  });
  // A greeting has no words to misunderstand: its first words always come out, with their lines.
  const parse = (value: unknown) =>
    parseGraphTalkOutput(typeof value === "object" && value !== null ? { ...value, input_understood: true } : value);
  const output = await askRole(runtime, "talk", { role: "graph_talk", prompt, context, parse });
  // A greeting offers only its first words, which come out regardless; a
  // revisit may restate what the player already holds.
  const harmless = new Set([...greeted.revealed, ...play.held]);
  const unoffered = [...output.opened, ...output.answered].filter((id) => !harmless.has(id));
  if (unoffered.length > 0) {
    rejectOutput(runtime, "talk", "Clue-graph greeting reported clues it did not offer", {
      character_id: character.id,
      clue_ids: unoffered,
    });
  }
  const { event, step } = withNotebook(game, runtime, play, talk, { action: "talk", lines: output.notebook });
  const kept = step.revealed;
  const portrait = character.portrait_image_id ?? null;

  return {
    event: {
      event_type: "talk",
      actor: "system",
      payload: {
        role: "graph_talk",
        character_id: character.id,
        character_name: character.first_name,
        location_id: session.current_location_id,
        character_portrait_image_id: portrait,
        speaker: NARRATOR_SPEAKER,
        revealed_clue_ids: kept,
        clue_graph: event,
      },
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER, portrait)],
      model: runtime.provider.resolvedModel,
      action: "talk",
      mode: session.mode,
    },
    costs_turn: true,
    resulting_mode: "talk",
    patch: { current_talk_character_id: character.id, discovered_clues: discoveredAfter(game, kept) },
    revealed_clues: recordsFor(game, step),
    result: null,
    endgame: {
      scene_summary: `The investigator approached ${character.first_name} to talk, and that last moment used up all remaining time.`,
      payload: { character_id: character.id, character_name: character.first_name, location_id: session.current_location_id },
    },
  };
}

/**
 * Files the narrator's reports by what the state offered: gates opened,
 * questions answered and subject tells shown. What the player already holds,
 * a tell that rides on a statement this line brings out,
 * or this line's first words, is dropped; anything else fails the turn.
 */
function acceptLine(
  game: TurnGame,
  runtime: TurnRuntime,
  play: ClueGraphPlay,
  characterId: string,
  output: { opened: string[]; answered: string[] },
): Extract<ClueGraphEvent, { type: "line" }> {
  const state = talkState(graphOf(game), play, characterId);
  const gates = new Set(state.gates.map((gate) => gate.id));
  const answers = new Set(state.answers_if_asked.map((answer) => answer.id));
  const tells = new Set(state.shows_when.map((tell) => tell.id));
  const dueNow = new Set(state.says_first.map((entry) => entry.id));
  const event = { type: "line" as const, character: characterId, opened: [] as string[], asked: [] as string[], seen: [] as string[] };
  const unoffered: string[] = [];
  const repeated: string[] = [];
  const others: string[] = [];
  // Generous on form: an offered id counts whichever list it came in.
  for (const id of new Set([...output.opened, ...output.answered])) {
    if (gates.has(id)) event.opened.push(id);
    else if (answers.has(id)) event.asked.push(id);
    else if (tells.has(id)) event.seen.push(id);
    // First words due come out this line regardless.
    else if (!dueNow.has(id)) others.push(id);
  }
  // A tell seen with a statement this line brings out comes out with it.
  const riding = new Set([...event.opened, ...event.asked, ...dueNow].flatMap((id) => ridersOf(graphOf(game), id)));
  for (const id of others) {
    if (play.held.includes(id)) repeated.push(id);
    else if (!riding.has(id)) unoffered.push(id);
  }
  if (repeated.length > 0) {
    runtime.logger.log("ask.clue_already_discovered", { game_id: game.game_id, character_id: characterId, clue_ids: repeated });
  }
  if (unoffered.length > 0) {
    rejectOutput(runtime, "ask", "Clue-graph conversation reported a gate or answer its state did not offer", {
      character_id: characterId,
      clue_ids: unoffered,
    });
  }
  return event;
}

export async function resolveGraphLine(
  game: TurnGame,
  runtime: TurnRuntime,
  ask: { character_id: string; question: string },
): Promise<ActionOutcome> {
  const { session } = game;
  const graph = graphOf(game);
  const character = game.blueprint.world.characters.find((entry) => entry.id === ask.character_id);
  if (!character) throw new RequestRejectedError(500, "Character missing in blueprint", "character_missing_in_blueprint");
  const speaker = createCharacterSpeaker(character.first_name);
  const play = playOf(graph, game.history);

  const { prompt, context } = await buildRoleRequest({
    role: "graph_talk",
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    reading_age: game.reading_age,
    character_id: character.id,
    location_id: session.current_location_id,
    player_input: ask.question,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "ask", { role: "graph_talk", prompt, context, parse: parseGraphTalkOutput });
  // A line not understood is no line: nothing comes out, first words included.
  const accepted = output.input_understood
    ? withNotebook(game, runtime, play, acceptLine(game, runtime, play, character.id, output), { action: "ask", lines: output.notebook })
    : null;
  const event = accepted?.event ?? null;
  const kept = accepted?.step.revealed ?? [];

  return {
    event: {
      event_type: "ask",
      actor: "system",
      payload: {
        role: "graph_talk",
        character_id: character.id,
        character_name: character.first_name,
        location_id: session.current_location_id,
        player_input: ask.question,
        character_portrait_image_id: character.portrait_image_id ?? null,
        speaker,
        revealed_clue_ids: kept,
        input_understood: output.input_understood,
        ...(event ? { clue_graph: event } : {}),
      },
      narration_parts: [createNarrationPart(output.narration, speaker, null)],
      model: runtime.provider.resolvedModel,
      action: "ask",
      mode: session.mode,
    },
    costs_turn: false,
    resulting_mode: "talk",
    patch: { discovered_clues: discoveredAfter(game, kept) },
    revealed_clues: accepted ? recordsFor(game, accepted.step) : [],
    result: null,
    endgame: null,
  };
}

/** A spot no case can name (spot names are never blank): the fold finds nothing there. */
const NO_SPOT = "";

/**
 * The search event to fold, from the narrator's report: the spot the engine
 * resolved, or for words that name no spot, the candidate the narrator chose.
 * Words that name nothing and find nothing search `NO_SPOT`: no clue, a turn spent.
 */
function searchEvent(
  runtime: TurnRuntime,
  resolved: ReturnType<typeof resolveGraphSearchWords>,
  revealed: string | null,
): Extract<ClueGraphEvent, { type: "search" }> {
  const { outcome } = resolved;
  if (outcome.kind === "known") {
    if (revealed !== (outcome.finds?.id ?? null))
      rejectOutput(runtime, "search", "Clue-graph search reported another clue than the spot holds", {
        spot: resolved.spot,
        reported_clue_id: revealed,
        expected_clue_id: outcome.finds?.id ?? null,
      });
    return resolved.spot === null ? { type: "search" } : { type: "search", spot: resolved.spot };
  }
  if (revealed === null) return { type: "search", spot: NO_SPOT };
  const candidate = outcome.candidates.find((entry) => entry.clue.id === revealed);
  if (!candidate)
    rejectOutput(runtime, "search", "Clue-graph search revealed a clue no visible spot holds", {
      reported_clue_id: revealed,
      candidate_clue_ids: outcome.candidates.map((entry) => entry.clue.id),
    });
  return candidate.spot === null ? { type: "search" } : { type: "search", spot: candidate.spot };
}

export async function resolveGraphSearch(game: TurnGame, runtime: TurnRuntime, query: string | null): Promise<ActionOutcome> {
  const { session, blueprint } = game;
  const graph = graphOf(game);
  const play = playOf(graph, game.history);
  if (play.at !== session.current_location_id) throw new Error("Clue-graph play disagrees with the session's location");
  const place = graph.locations[play.at];

  const { prompt, context } = await buildRoleRequest({
    role: "graph_search",
    game_id: game.game_id,
    session,
    blueprint,
    reading_age: game.reading_age,
    location_id: play.at,
    search_query: query,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "search", { role: "graph_search", prompt, context, parse: parseGraphSearchOutput });
  // Gibberish searches nothing and costs nothing.
  const accepted = output.input_understood
    ? withNotebook(game, runtime, play, searchEvent(runtime, resolveGraphSearchWords(graph, play, query), output.revealed_clue_id), {
        action: "search",
        lines: output.notebook,
      })
    : null;
  const event = accepted?.event ?? null;
  const kept = accepted?.step.revealed ?? [];
  const clueId = kept[0] ?? null;

  return {
    event: {
      event_type: "search",
      actor: "system",
      payload: {
        role: "search",
        location_id: play.at,
        location_name: place.name,
        search_query: query,
        revealed_clue_id: clueId,
        revealed_clue_text: clueId ? lineOf(graph, accepted!.step.play, clueId) : null,
        revealed_clue_ids: kept,
        revealed_off_script: [],
        costs_turn: event !== null,
        input_understood: output.input_understood,
        speaker: NARRATOR_SPEAKER,
        ...(event ? { clue_graph: event } : {}),
      },
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
      model: runtime.provider.resolvedModel,
      action: "search",
      mode: session.mode,
    },
    costs_turn: event !== null,
    resulting_mode: session.mode,
    patch: { current_talk_character_id: null, discovered_clues: discoveredAfter(game, kept) },
    revealed_clues: accepted ? recordsFor(game, accepted.step) : [],
    result: null,
    endgame: {
      scene_summary: `The investigator just searched ${place.name}, and this action exhausted the remaining time.`,
      payload: { location_id: play.at, location_name: place.name },
    },
  };
}
