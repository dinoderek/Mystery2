// Shared clue-discovery helpers.
//
// Discovery is event-sourced: a clue is "discovered" once a search or ask event
// recorded its id. `game_sessions.discovered_clues` is a denormalized cache of
// this set kept in sync by the search/ask handlers; the event history remains the
// source of truth, so these helpers reconstruct the set from history and are the
// single place that knows how reveals are encoded in event payloads.
//
// A clue may also carry an optional `requires` gate (prerequisite clue ids that
// must be discovered first); `isClueUnlocked` decides whether a gate is satisfied.

export interface ClueRequires {
  clue_ids: string[];
  rationale: string;
}

export interface GatedClue {
  id: string;
  requires?: ClueRequires | null;
}

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

// The clue ids a single search/ask event recorded as revealed. Reads the v2
// `revealed_clue_ids` array plus the legacy single `revealed_clue_id`.
export function eventRevealedClueIds(event: DiscoveryHistoryRow): string[] {
  if (event.event_type !== "search" && event.event_type !== "ask") return [];
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

// A clue is unlocked when every prerequisite clue has already been discovered.
// Ungated clues (absent/null/empty requires) are always unlocked.
export function isClueUnlocked(
  clue: GatedClue,
  discovered: Set<string>,
): boolean {
  const required = clue.requires?.clue_ids ?? [];
  return required.every((id) => discovered.has(id));
}

// --- Notebook: discovered-clue records grouped by mini-mystery thread ---

interface NotebookClue {
  id: string;
  text: string;
}

interface NotebookReasoningPath {
  summary: string;
  payoff?: string | null;
  location_clue_ids: string[];
  character_clue_ids: string[];
}

export interface NotebookBlueprint {
  world: {
    locations: Array<{
      id: string;
      name: string;
      clues: NotebookClue[];
      sub_locations?: Array<{ clues: NotebookClue[] }>;
    }>;
    characters: Array<{
      id: string;
      first_name: string;
      last_name: string;
      clues: NotebookClue[];
    }>;
  };
  solution_paths: NotebookReasoningPath[];
  red_herrings: NotebookReasoningPath[];
  suspect_elimination_paths: NotebookReasoningPath[];
}

export type DiscoveryThread =
  | { kind: "solution"; label: string }
  | { kind: "red_herring"; label: string }
  | { kind: "eliminate"; label: string };

export type DiscoveryOrigin =
  | { kind: "location"; location_id: string; location_name: string }
  | { kind: "character"; character_id: string; character_name: string };

export interface DiscoveredClueRecord {
  id: string;
  text: string;
  source: "search" | "talk";
  origin: DiscoveryOrigin;
  discovered_at: string | null;
  off_script: boolean;
  threads: DiscoveryThread[];
}

// Which mini-mystery threads a clue serves, derived from reasoning-path
// membership. A clue may serve several threads; the notebook groups by these.
export function mapClueToThreads(
  blueprint: NotebookBlueprint,
  clueId: string,
): DiscoveryThread[] {
  const threads: DiscoveryThread[] = [];
  const inPath = (path: NotebookReasoningPath) =>
    path.location_clue_ids.includes(clueId) ||
    path.character_clue_ids.includes(clueId);

  if (blueprint.solution_paths.some(inPath)) {
    threads.push({ kind: "solution", label: "Main solution" });
  }
  for (const path of blueprint.red_herrings) {
    if (inPath(path)) {
      threads.push({ kind: "red_herring", label: `Red herring: ${path.payoff ?? path.summary}` });
    }
  }
  for (const path of blueprint.suspect_elimination_paths) {
    if (inPath(path)) {
      threads.push({ kind: "eliminate", label: `Ruling out: ${path.payoff ?? path.summary}` });
    }
  }
  return threads;
}

interface ClueIndexEntry {
  text: string;
  origin: DiscoveryOrigin;
}

function buildClueIndex(blueprint: NotebookBlueprint): Map<string, ClueIndexEntry> {
  const index = new Map<string, ClueIndexEntry>();
  for (const location of blueprint.world.locations) {
    const origin: DiscoveryOrigin = {
      kind: "location",
      location_id: location.id,
      location_name: location.name,
    };
    for (const clue of location.clues) index.set(clue.id, { text: clue.text, origin });
    for (const sub of location.sub_locations ?? []) {
      for (const clue of sub.clues) index.set(clue.id, { text: clue.text, origin });
    }
  }
  for (const character of blueprint.world.characters) {
    const origin: DiscoveryOrigin = {
      kind: "character",
      character_id: character.id,
      character_name: `${character.first_name} ${character.last_name}`.trim(),
    };
    for (const clue of character.clues) index.set(clue.id, { text: clue.text, origin });
  }
  return index;
}

// Build the player-facing notebook: one record per discovered clue, in discovery
// order, annotated with where/when it was found, whether it was an off-script
// grant, and which mini-mystery threads it serves.
export function buildDiscoveryRecords(
  blueprint: NotebookBlueprint,
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
        source: event.event_type === "ask" ? "talk" : "search",
        origin: entry.origin,
        discovered_at: event.created_at ?? null,
        off_script: offScript.has(id),
        threads: mapClueToThreads(blueprint, id),
      });
    }
  }
  return records;
}
