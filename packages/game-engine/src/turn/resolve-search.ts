// Searching: the narrator judges the search, and the engine decides whether
// the clue it names may be found. Search gates are hard.

import type { RevealedClue } from "../../../shared/src/mystery-api-contracts.ts";
import { parseSearchOutput } from "../ai-contracts.ts";
import { findLocationById, type BlueprintClue } from "../ai-context.ts";
import { buildDiscoveredClueIdSet, isClueUnlocked } from "../clue-discovery.ts";
import { RequestRejectedError } from "../errors.ts";
import { createNarrationPart } from "../narration.ts";
import { buildRoleRequest, resolveSearchRole } from "../role-request.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";
import { askRole } from "./narrator.ts";
import type { ActionOutcome, TurnGame, TurnRuntime } from "./types.ts";

type SearchHistoryRow = {
  event_type: string;
  payload?: Record<string, unknown> | null;
};

type SearchedLocation = {
  id: string;
  name: string;
  clues: BlueprintClue[];
  sub_locations?: Array<{ clues: BlueprintClue[] }>;
};

function readPayloadField(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPayloadStringArray(payload: Record<string, unknown> | null | undefined, key: string): string[] {
  const value = payload?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/** Every clue at a location, its sub-locations' included. */
export function collectAllLocationClueIds(location: Pick<SearchedLocation, "clues" | "sub_locations">): string[] {
  return [
    ...location.clues.map((clue) => clue.id),
    ...(location.sub_locations ?? []).flatMap((sub) => sub.clues.map((clue) => clue.id)),
  ];
}

function searchedHere(entry: SearchHistoryRow, locationId: string): boolean {
  return (
    entry.event_type === "search" &&
    (readPayloadField(entry.payload, "location_id") === locationId ||
      readPayloadField(entry.payload, "location_name") === locationId)
  );
}

function recordedReveals(event: SearchHistoryRow): string[] {
  const single = readPayloadField(event.payload, "revealed_clue_id");
  return [...readPayloadStringArray(event.payload, "revealed_clue_ids"), ...(single ? [single] : [])];
}

/**
 * The clue ids earlier searches at this location revealed, in order. Every
 * search event records `revealed_clue_ids` and `revealed_clue_id`, even when it
 * found nothing, and those records are the answer. Only when no search at the
 * location records them (events from before they existed) are the location's
 * first clues assumed found, one per search. A search that found nothing must
 * not count as having found one: that credited the next clue without
 * narration, and past its `requires` gate.
 */
export function collectRevealedClueIds(
  historyRows: SearchHistoryRow[],
  locationId: string,
  allCanonicalClueIds: string[],
): string[] {
  const searches = historyRows.filter((entry) => searchedHere(entry, locationId));
  const canonical = new Set(allCanonicalClueIds);
  const revealed: string[] = [];
  for (const clueId of searches.flatMap(recordedReveals)) {
    if (canonical.has(clueId) && !revealed.includes(clueId)) revealed.push(clueId);
  }

  const recordsReveals = searches.some(
    (event) => event.payload != null && ("revealed_clue_ids" in event.payload || "revealed_clue_id" in event.payload),
  );
  if (recordsReveals || revealed.length > 0) return revealed;

  // Legacy events, which do not record reveals: infer from their count.
  return allCanonicalClueIds.slice(0, searches.length);
}

function cluesAt(location: SearchedLocation): Map<string, BlueprintClue> {
  const clues = new Map<string, BlueprintClue>();
  for (const clue of location.clues) clues.set(clue.id, clue);
  for (const sub of location.sub_locations ?? []) {
    for (const clue of sub.clues) clues.set(clue.id, clue);
  }
  return clues;
}

/**
 * The clue the narrator named, if it may be found here now: it belongs to this
 * location, has not been found anywhere yet, and its prerequisites are found.
 * There is no brilliance override for a search, unlike a conversation.
 */
function admitClue(
  runtime: TurnRuntime,
  location: SearchedLocation,
  named: string | null,
  found: { here: string[]; anywhere: Set<string> },
): BlueprintClue | null {
  if (named === null) return null;
  const clue = cluesAt(location).get(named);
  const alreadyRevealed = found.here.includes(named) || found.anywhere.has(named);
  if (!clue || alreadyRevealed) {
    runtime.logger.log("search.clue_validation_failed", {
      game_id: runtime.game_id,
      ai_clue_id: named,
      exists: !!clue,
      already_revealed: alreadyRevealed,
    });
    return null;
  }
  if (!isClueUnlocked(clue, found.anywhere)) {
    runtime.logger.log("search.clue_locked", {
      game_id: runtime.game_id,
      ai_clue_id: named,
      requires: clue.requires?.clue_ids ?? [],
    });
    return null;
  }
  return clue;
}

function revealedRecord(clue: BlueprintClue, location: SearchedLocation): RevealedClue {
  return {
    id: clue.id,
    text: clue.text,
    source: "search",
    origin: { kind: "location", location_id: location.id, location_name: location.name },
    discovered_at: new Date().toISOString(),
    off_script: false,
  };
}

export async function resolveSearch(
  game: TurnGame,
  runtime: TurnRuntime,
  query: string | null,
): Promise<ActionOutcome> {
  const { session, blueprint, history } = game;
  const location = findLocationById(blueprint, session.current_location_id);
  if (!location) {
    throw new RequestRejectedError(500, "Current location not found in blueprint", "current_location_missing_in_blueprint");
  }

  const here = collectRevealedClueIds(history, location.id, collectAllLocationClueIds(location));
  // Gating reads the whole session: a prerequisite may be found anywhere.
  const anywhere = buildDiscoveredClueIdSet(history);
  // A plain search skips a locked clue for the next open one, so it never dead-ends.
  const nextClue =
    query === null
      ? (location.clues.find((clue) => !here.includes(clue.id) && isClueUnlocked(clue, anywhere)) ?? null)
      : null;

  const { prompt, context } = await buildRoleRequest({
    role: resolveSearchRole(query),
    game_id: game.game_id,
    session,
    blueprint,
    location_id: location.id,
    revealed_clue_ids: here,
    discovered_clue_ids: [...anywhere],
    next_clue: nextClue,
    search_query: query,
    conversation_history: history,
  });
  const output = await askRole(runtime, "search", { role: "search", prompt, context, parse: parseSearchOutput });
  const model = runtime.provider.resolvedModel;

  const clue = admitClue(runtime, location, output.revealed_clue_id, { here, anywhere });
  // A plain search always costs, as does a find; otherwise the narrator decides.
  const costsTurn = query === null || clue !== null || output.costs_turn;

  return {
    event: {
      event_type: "search",
      actor: "system",
      payload: {
        role: "search",
        location_id: location.id,
        location_name: location.name,
        search_query: query,
        revealed_clue_id: clue?.id ?? null,
        revealed_clue_text: clue?.text ?? null,
        revealed_clue_ids: clue ? [...here, clue.id] : here,
        costs_turn: costsTurn,
        input_understood: output.input_understood,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
      model,
      action: "search",
      mode: session.mode,
    },
    costs_turn: costsTurn,
    resulting_mode: session.mode,
    patch: {
      current_talk_character_id: null,
      discovered_clues: clue ? [...new Set([...session.discovered_clues, clue.id])] : session.discovered_clues,
    },
    revealed_clues: clue ? [revealedRecord(clue, location)] : [],
    result: null,
    endgame: {
      scene_summary: `The investigator just searched ${location.name}, and this action exhausted the remaining time.`,
      payload: { location_id: location.id, location_name: location.name },
    },
  };
}
