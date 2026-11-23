// Shared clue-discovery helpers.
//
// Discovery is event-sourced: a clue is "discovered" once a search or ask event
// recorded its id. `game_sessions.discovered_clues` is a denormalized cache of
// this set kept in sync by the search/ask handlers; the event history remains the
// source of truth, so these helpers reconstruct the set from history and are the
// single place that knows how reveals are encoded in event payloads.

export interface DiscoveryHistoryRow {
  event_type: string;
  payload?: Record<string, unknown> | null;
}

function readStringArray(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  if (!payload) return [];
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function readString(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!payload) return null;
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// The clue ids a single search, ask or talk event recorded as revealed (a
// greeting gives first words). Reads the `revealed_clue_ids` array plus the
// single `revealed_clue_id` a search also records.
export function eventRevealedClueIds(event: DiscoveryHistoryRow): string[] {
  if (!["search", "ask", "talk"].includes(event.event_type)) return [];
  const ids = new Set(readStringArray(event.payload, "revealed_clue_ids"));
  const single = readString(event.payload, "revealed_clue_id");
  if (single) ids.add(single);
  return [...ids];
}

// Reconstruct the full set of discovered clue ids from event history. Canonical
// reconstruction shared by the runtime context builders and the read endpoint.
export function buildDiscoveredClueIdSet(
  historyRows: DiscoveryHistoryRow[],
): Set<string> {
  const discovered = new Set<string>();
  for (const event of historyRows) {
    for (const id of eventRevealedClueIds(event)) discovered.add(id);
  }
  return discovered;
}

// --- Notebook: discovered-clue records ---

interface NotebookClue {
  id: string;
  text: string;
}

// The world shape needed to resolve a clue id to its text and where it came
// from. Sub-location clues take their parent location's origin.
export interface ClueOriginWorld {
  world: {
    locations: Array<{
      id: string;
      name: string;
      clues: NotebookClue[];
      sub_locations: Array<{ clues: NotebookClue[] }>;
    }>;
    characters: Array<{
      id: string;
      /** A clue-graph character goes by one name. */
      first_name: string;
      clues: NotebookClue[];
    }>;
  };
}

export type DiscoveryOrigin =
  | { kind: "location"; location_id: string; location_name: string }
  | { kind: "character"; character_id: string; character_name: string };

// The notebook groups records by `origin`.
export interface DiscoveredClueRecord {
  id: string;
  text: string;
  source: "search" | "talk";
  origin: DiscoveryOrigin;
  discovered_at: string | null;
  off_script: boolean;
}

interface ClueIndexEntry {
  text: string;
  origin: DiscoveryOrigin;
}

function buildClueIndex(blueprint: ClueOriginWorld): Map<string, ClueIndexEntry> {
  const index = new Map<string, ClueIndexEntry>();
  for (const location of blueprint.world.locations) {
    const origin: DiscoveryOrigin = {
      kind: "location",
      location_id: location.id,
      location_name: location.name,
    };
    for (const clue of location.clues) index.set(clue.id, { text: clue.text, origin });
    for (const sub of location.sub_locations) {
      for (const clue of sub.clues) index.set(clue.id, { text: clue.text, origin });
    }
  }
  for (const character of blueprint.world.characters) {
    const origin: DiscoveryOrigin = {
      kind: "character",
      character_id: character.id,
      character_name: character.first_name,
    };
    for (const clue of character.clues) index.set(clue.id, { text: clue.text, origin });
  }
  return index;
}

// Build the player-facing notebook: one record per discovered clue, in discovery
// order, annotated with where and when it was found.
export function buildDiscoveryRecords(
  blueprint: ClueOriginWorld,
  historyRows: Array<DiscoveryHistoryRow & { created_at?: string | null }>,
): DiscoveredClueRecord[] {
  const index = buildClueIndex(blueprint);
  const records: DiscoveredClueRecord[] = [];
  const seen = new Set<string>();

  for (const event of historyRows) {
    const ids = eventRevealedClueIds(event);
    if (ids.length === 0) continue;
    const offScript = new Set(readStringArray(event.payload, "revealed_off_script"));
    for (const id of ids) {
      if (seen.has(id)) continue;
      const entry = index.get(id);
      if (!entry) continue; // unknown id (stale event) — skip
      seen.add(id);
      records.push({
        id,
        text: entry.text,
        source: event.event_type === "search" ? "search" : "talk",
        origin: entry.origin,
        discovered_at: event.created_at ?? null,
        off_script: offScript.has(id),
      });
    }
  }
  return records;
}
