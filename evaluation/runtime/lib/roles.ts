// Shared action map — how a case's `action` (+ fixed `given` state and history)
// becomes either an endpoint call or a local prompt replay.
//
// A case evaluates exactly ONE action against a fully-specified prior state, so
// the input is deterministic and identical across models. There is no turn
// accumulation here — `given.history` is the complete, fixed conversation.
//
// Role resolution and prompt assembly are NOT here: they live in
// packages/game-engine/src/role-request.ts, shared with the server
// handlers, so both paths pick the same role and build the same prompt.

import {
  resolveAccusationRole,
  resolveSearchRole,
} from "../../../packages/game-engine/src/role-request.ts";
import type { BlueprintLike, Given, HistoryEntry, Speaker, TurnAction } from "./case.ts";

/** A history row with every field a context builder reads filled in. */
export interface HistoryRow {
  sequence: number;
  event_type: string;
  actor: string;
  narration: string;
  payload: Record<string, unknown>;
}

/** What an action's endpoint call needs besides the case. */
interface EndpointExtra {
  blueprint: BlueprintLike;
  aiProfile: string;
}

type LineBuilder = (given: Given, action: TurnAction, blueprint: BlueprintLike) => string;

export interface ActionSpec {
  requiredMode: string | null;
  createsSession?: boolean;
  line?: LineBuilder;
  events?: string[];
  endpoint: {
    name: string;
    method: string;
    body: (given: Given, action: TurnAction, gameId?: string | null, extra?: EndpointExtra) => Record<string, unknown>;
  };
  roleInput: (
    given: Given,
    action: TurnAction,
    blueprint: BlueprintLike,
    history?: HistoryRow[],
  ) => Record<string, unknown> & { role: string };
  speaker: (given: Given, action: TurnAction, blueprint: BlueprintLike) => Speaker;
}

export function characterFirstName(blueprint: BlueprintLike, characterId: string | undefined): string {
  return blueprint.world.characters.find((c) => c.id === characterId)?.first_name ?? String(characterId);
}
export function locationName(blueprint: BlueprintLike, locationId: string | undefined): string {
  return blueprint.world.locations.find((l) => l.id === locationId)?.name ?? String(locationId);
}

function characterFullName(blueprint: BlueprintLike, characterId: string | undefined): string {
  const character = blueprint.world.characters.find((c) => c.id === characterId);
  if (!character) throw new Error(`Character "${characterId}" is not in the blueprint`);
  return `${character.first_name} ${character.last_name ?? ""}`.trim();
}

// A structured action as the line a player would type for it. The engine's
// grammar reads the line back, so each builder names its target the way that
// grammar accepts: places by id, characters by their name in the blueprint.
// A line the grammar reads as another action (a question of "bye" ends the
// conversation) is caught by the server narrator, which checks the event the
// turn saved against the action's `events`.
function accusationLine(given: Given, action: TurnAction): string {
  const reasoning = action.player_reasoning?.trim();
  if (given.mode === "accuse") {
    // Every line typed during the accusation is reasoning; none reopens it.
    if (!reasoning) throw new Error("An accusation already open needs player_reasoning to continue");
    return reasoning;
  }
  return reasoning ? `accuse ${reasoning}` : "accuse";
}

const talkLine: LineBuilder = (g, a, bp) => `talk to ${characterFullName(bp, a.character_id)}`;
const askLine: LineBuilder = (g, a) => a.player_input ?? "";
const endTalkLine: LineBuilder = () => "bye";
const moveLine: LineBuilder = (g, a) => `move to ${a.destination}`;
const searchLine: LineBuilder = (g, a) => (a.search_query ? `search ${a.search_query}` : "search");

/** The POST /api/game-turn call for a line, in the server narrator's shape. */
const turnEndpoint = (line: LineBuilder): ActionSpec["endpoint"] => ({
  name: "game-turn",
  method: "POST",
  body: (g, a, gid, extra) => ({ game_id: gid, input: line(g, a, extra?.blueprint as BlueprintLike) }),
});

export function narratorSpeaker(): Speaker {
  return { kind: "narrator", key: "narrator", label: "Narrator" };
}
export function characterSpeaker(firstName: string): Speaker {
  return { kind: "character", key: `character:${String(firstName).toLowerCase()}`, label: firstName };
}

/** SessionSnapshot the context builders expect, derived from `given`. */
export function snapshotFromGiven(given: Given) {
  return {
    mode: given.mode,
    current_location_id: given.location_id,
    current_talk_character_id: given.talk_character_id ?? null,
    time_remaining: given.time_remaining,
  };
}

// Each action maps to:
//   requiredMode  — session mode the action is valid from (also what we seed);
//                   null for an action that has no prior state
//   createsSession — true when the endpoint CREATES the session rather than
//                   acting on a seeded one (`start` only). The server narrator
//                   skips seeding and the body identifies the blueprint instead
//                   of a game id.
//   line          — the typed line that plays the action (every action but
//                   `start`), line(given, action, blueprint)
//   events        — the event types a played turn of this action saves first
//   endpoint      — how to call the live function (name, method, body builder).
//                   body(given, action, gameId, { blueprint, aiProfile }); the
//                   turn actions all post their line to game-turn
//   roleInput     — the RoleRequestInput for the local (CLI) replay of the same
//                   turn, built from the case's fixed `given` + `action`
//   speaker       — who the resulting narration is attributed to
//
// `roleInput` deliberately carries NO prompt or context logic: it names the role
// and hands over the same fields the handler would, and
// packages/game-engine/src/role-request.ts does the assembly for both. The
// per-action `cli` blocks that used to live here duplicated that assembly and
// drifted out of sync with the handlers (see prompt-build.mjs).
export const ACTIONS: Record<string, ActionSpec> = {
  // The opening narration. Unlike every other action there is no prior state to
  // seed: game-start creates the session, so `given` is empty and the endpoint
  // body names the blueprint rather than a game.
  start: {
    requiredMode: null,
    createsSession: true,
    endpoint: {
      name: "game-start",
      method: "POST",
      body: (g, a, gid, extra) => ({
        blueprint_id: extra?.blueprint.id,
        ai_profile: extra?.aiProfile,
      }),
    },
    roleInput: (g, a, bp) => ({
      role: "intro",
      game_id: "case",
      blueprint: bp,
      conversation_history: [],
    }),
    speaker: () => narratorSpeaker(),
  },

  talk: {
    requiredMode: "explore",
    line: talkLine,
    endpoint: turnEndpoint(talkLine),
    events: ["talk"],
    roleInput: (g, a, bp, history = []) => ({
      role: "talk_start",
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      character_id: a.character_id,
      location_id: g.location_id,
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  ask: {
    requiredMode: "talk",
    line: askLine,
    endpoint: turnEndpoint(askLine),
    events: ["ask"],
    roleInput: (g, a, bp, history = []) => ({
      role: "talk_conversation",
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      character_id: g.talk_character_id,
      location_id: g.location_id,
      player_input: a.player_input,
      conversation_history: history,
    }),
    speaker: (g, a, bp) => characterSpeaker(characterFirstName(bp, g.talk_character_id)),
  },

  end_talk: {
    requiredMode: "talk",
    line: endTalkLine,
    endpoint: turnEndpoint(endTalkLine),
    events: ["end_talk"],
    roleInput: (g, a, bp, history = []) => ({
      role: "talk_end",
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      character_id: g.talk_character_id,
      location_id: g.location_id,
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  move: {
    requiredMode: "explore",
    line: moveLine,
    endpoint: turnEndpoint(moveLine),
    events: ["move"],
    roleInput: (g, a, bp, history = []) => ({
      role: "ambience",
      game_id: "case",
      blueprint: bp,
      destination_id: a.destination,
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  search: {
    requiredMode: "explore",
    line: searchLine,
    endpoint: turnEndpoint(searchLine),
    events: ["search"],
    roleInput: (g, a, bp, history = []) => ({
      role: resolveSearchRole(a.search_query),
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      location_id: g.location_id,
      revealed_clue_ids: g.revealed_clue_ids ?? [],
      discovered_clue_ids: g.discovered_clues ?? [],
      next_clue: a.search_query ? null : (nextUnrevealedClue(bp, g) ?? null),
      search_query: a.search_query ?? null,
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  accuse: {
    requiredMode: "accuse",
    line: accusationLine,
    endpoint: turnEndpoint(accusationLine),
    events: ["accuse_start", "accuse_round", "accuse_resolved"],
    roleInput: (g, a, bp, history = []) => {
      const role = resolveAccusationRole(a.player_reasoning);
      const base = {
        role,
        game_id: "case",
        blueprint: bp,
        session: { ...snapshotFromGiven(g), mode: "accuse", current_talk_character_id: null },
        conversation_history: history,
        ...(a.accusation_history_mode ? { history_mode: a.accusation_history_mode } : {}),
      };
      return role === "accusation_judge"
        ? {
          ...base,
          player_input: a.player_reasoning,
          round: history.filter((e) => e.event_type === "accuse_round").length,
        }
        : base;
    },
    speaker: () => narratorSpeaker(),
  },
};

/**
 * The first location-level clue a bare search would surface, mirroring the
 * handler's rule (unrevealed AND unlocked). Locking needs the session-global
 * discovered set, which a case supplies via `given.discovered_clues`.
 */
function nextUnrevealedClue(blueprint: BlueprintLike, given: Given) {
  const location = (blueprint.world.locations ?? []).find((l) => l.id === given.location_id);
  if (!location) return null;
  const revealed = new Set(given.revealed_clue_ids ?? []);
  const discovered = new Set(given.discovered_clues ?? []);
  return (
    (location.clues ?? []).find(
      (c) =>
        !revealed.has(c.id) &&
        (c.requires?.clue_ids ?? []).every((id) => discovered.has(id)),
    ) ?? null
  );
}

/**
 * The AI role an action resolves to, via the SAME roleInput mapping the
 * narrator replay uses — so a judge labels a turn with the role the model actually ran
 * as, including the resolutions that depend on the input (a search with a query
 * is `search_targeted`, an accusation with reasoning is `accusation_judge`).
 */
export function resolveRoleName(
  actionType: string,
  given: Given,
  action: TurnAction,
  blueprint: BlueprintLike,
  history: HistoryEntry[] | undefined,
): string {
  return getAction(actionType).roleInput(given, action, blueprint, normalizeHistory(history)).role;
}

/** Whether a role name belongs to the endgame, where the solution is discussed. */
export function isAccusationRole(roleName: unknown): boolean {
  return typeof roleName === "string" && roleName.startsWith("accusation");
}

export function getAction(type: string): ActionSpec {
  const action = ACTIONS[type];
  if (!action) {
    throw new Error(`Unknown action type "${type}". Known: ${Object.keys(ACTIONS).join(", ")}`);
  }
  return action;
}

/**
 * Normalize a case's `given.history` into ConversationFragment / game_events
 * rows: assign sequential `sequence` when omitted and default actor to "system".
 */
export function normalizeHistory(history: HistoryEntry[] | null | undefined): HistoryRow[] {
  return (history ?? []).map((entry, i) => ({
    sequence: entry.sequence ?? i + 1,
    event_type: entry.event_type,
    actor: entry.actor ?? "system",
    narration: entry.narration ?? "",
    payload: entry.payload ?? {},
  }));
}
