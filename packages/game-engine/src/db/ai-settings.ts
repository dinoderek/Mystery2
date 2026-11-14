// `AISettingsStore` over SQLite: the name of the AI chosen on the settings page.
//
// App-global, not player-scoped — modelled on `players.ts` rather than
// `sessions.ts`. The settings page is reachable before anyone has picked a
// profile, so there is no player to scope to, and the choice is a property of
// this installation rather than of a person.
//
// The name is stored as given. Whether it names an AI is the caller's check
// when it is chosen, and the resolver's when it is used: `ai.json` can change
// between starts, so a stored name may stop naming anything.

import type { AISettingsStore } from "../context.ts";
import type { Db } from "./client.ts";

/** The one row's id; the table's check allows no other. */
const ROW_ID = 1;

export function createAISettingsStore(db: Db): AISettingsStore {
  return {
    getChoice() {
      const row = db.prepare("select ai_name from app_settings where id = ?").get(ROW_ID);
      return row ? String(row.ai_name) : null;
    },

    setChoice(name) {
      db.prepare(
        `insert into app_settings (id, ai_name) values (?, ?)
         on conflict(id) do update set ai_name = excluded.ai_name`,
      ).run(ROW_ID, name);
    },
  };
}
