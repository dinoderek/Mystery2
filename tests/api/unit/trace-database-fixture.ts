// A play database the test makes for itself: one played session of the
// clue-graph mock case, with the private snapshot a start saves, in a
// directory the test owns. Not a .test.ts
// file, so vitest imports it without running it as a suite.
//
// The database is made at an explicit path, never the one `resolveDatabasePath()`
// names, as `docs/testing.md` ("Isolation") requires.

import path from "node:path";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { MOCK_CASE_ID, readMockCaseGraph } from "../../testkit/src/mock-case.ts";

export interface GameDatabase {
  /** The directory everything lives in. */
  root: string;
  databasePath: string;
  sessionId: string;
  blueprintId: string;
}

const SESSION_ID = "session-under-test";
const NOW = "2026-06-02T00:00:00Z";

function parts(text: string): string {
  return JSON.stringify([{ text, speaker: { kind: "narrator" } }]);
}

export interface GameDatabaseOptions {
  /** The AI name the session was started with. */
  profileId?: string;
  /** The model recorded on the session's narrated event. */
  eventModel?: string;
}

/** Makes `<dir>/game.db` with one played session of the mock case, whose graph the session holds. */
export function createGameDatabase(dir: string, { profileId = "mock", eventModel = "mock" }: GameDatabaseOptions = {}): GameDatabase {
  const blueprintId = MOCK_CASE_ID;
  const snapshot = JSON.stringify(readMockCaseGraph());

  const databasePath = path.join(dir, "game.db");
  const db = openDatabase({ path: databasePath });
  try {
    db.prepare("insert into players (id, name, created_at, updated_at) values (?, ?, ?, ?)").run(
      "player-1",
      "Tester",
      NOW,
      NOW,
    );
    db.prepare(
      `insert into game_sessions (id, player_id, blueprint_id, ai_profile_id, mode, current_location_id,
                                   time_remaining, discovered_clues, outcome, created_at, updated_at, clue_graph_snapshot)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(SESSION_ID, "player-1", blueprintId, profileId, "explore", "loc-kitchen", 9, "[]", null, NOW, NOW, snapshot);
    const insertEvent = db.prepare(
      `insert into game_events (id, session_id, sequence, event_type, actor, payload, narration, narration_parts, model, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertEvent.run("event-1", SESSION_ID, 1, "start", "system", null, "You arrive in the kitchen.", parts("You arrive in the kitchen."), null, NOW);
    insertEvent.run(
      "event-2",
      SESSION_ID,
      2,
      "search",
      "player",
      JSON.stringify({ location_id: "loc-kitchen", search_query: "the pantry shelf", clue_graph: { type: "search", spot: "the pantry shelf" } }),
      "You look over the pantry shelf and find an empty jar.",
      parts("You look over the pantry shelf and find an empty jar."),
      eventModel,
      NOW,
    );
  } finally {
    db.close();
  }
  return { root: dir, databasePath, sessionId: SESSION_ID, blueprintId };
}
