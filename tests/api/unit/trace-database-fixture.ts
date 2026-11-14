// A play database the test makes for itself: one played session, and the
// blueprint it was played on, in a directory the test owns. Not a .test.ts
// file, so vitest imports it without running it as a suite.
//
// The database is made at an explicit path, never the one `resolveDatabasePath()`
// names, as `docs/testing.md` ("Isolation") requires.

import fs from "node:fs";
import path from "node:path";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

export interface GameDatabase {
  /** The directory everything lives in; it holds `blueprints/` as a repo root does. */
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

/** Makes `<dir>/game.db` with one played session and `<dir>/blueprints/<id>.json`. */
export function createGameDatabase(dir: string): GameDatabase {
  const blueprintId = validBlueprintV2.id;
  fs.mkdirSync(path.join(dir, "blueprints"), { recursive: true });
  fs.writeFileSync(path.join(dir, "blueprints", `${blueprintId}.json`), JSON.stringify(validBlueprintV2));

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
                                   time_remaining, discovered_clues, outcome, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(SESSION_ID, "player-1", blueprintId, "mock", "explore", "kitchen", 11, "[]", null, NOW, NOW);
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
      JSON.stringify({ location_id: "kitchen", search_query: "the counter" }),
      "You look over the counter and find nothing.",
      parts("You look over the counter and find nothing."),
      "mock",
      NOW,
    );
  } finally {
    db.close();
  }
  return { root: dir, databasePath, sessionId: SESSION_ID, blueprintId };
}
