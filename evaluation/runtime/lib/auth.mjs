// Profile bootstrap for the runtime evaluation harness.
//
// Functionally mirrors tests/testkit/src/server.ts: create a throwaway local
// profile and return the headers that act as it. It used to create an auth
// user through the admin API and sign it in for a bearer token; a profile is
// now a name, and the answer is a cookie.

import { resolveEnv } from "./env.mjs";

/**
 * Creates a throwaway profile and returns its request headers, plus a
 * `cleanup()` that removes the sessions it accumulated.
 */
export async function setupHarnessAuth(tag = "runtime-eval", env = resolveEnv()) {
  const name = `${tag}-${crypto.randomUUID().slice(0, 8)}`;

  const res = await fetch(`${env.apiUrl}/player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create harness profile ${name}: HTTP ${res.status}`);
  }
  const { player } = await res.json();

  return {
    player,
    headers: {
      "Content-Type": "application/json",
      Cookie: `mystery-player-id=${player.id}`,
    },
    // The harness seeds sessions into the same database a human plays on, so
    // it does clean up after itself — unlike the test suites, which throw the
    // whole database away.
    cleanup: async () => {
      const { openDatabase } = await import("../../../packages/game-engine/src/db/client.ts");
      const { resolveDatabasePath } = await import(
        "../../../packages/game-engine/src/paths.ts"
      );
      const db = openDatabase({ path: resolveDatabasePath() });
      try {
        // game_events cascades.
        db.prepare("delete from game_sessions where player_id = ?").run(player.id);
        db.prepare("delete from players where id = ?").run(player.id);
      } finally {
        db.close();
      }
    },
  };
}
