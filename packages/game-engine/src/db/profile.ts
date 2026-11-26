// `ProfileStore` over SQLite: the playing profile's own settings.
//
// `players.ts` is app-global, because the picker lists every profile. This
// store is not: every statement is scoped to one player, like `sessions.ts`,
// so a handler can change only the profile it runs as.

import type { ProfileStore } from "../context.ts";
import { ReadingAgeSchema } from "../../../shared/src/reading-age.ts";
import type { Db } from "./client.ts";

export function createProfileStore(db: Db, playerId: string): ProfileStore {
  return {
    async getReadingAge() {
      const row = db.prepare("select reading_age from players where id = ?").get(playerId);
      return typeof row?.reading_age === "number" ? row.reading_age : null;
    },

    async setReadingAge(age) {
      const result = db
        .prepare("update players set reading_age = ?, updated_at = ? where id = ?")
        .run(ReadingAgeSchema.parse(age), new Date().toISOString(), playerId);
      if (result.changes === 0) throw new Error(`Profile ${playerId} does not exist`);
    },
  };
}
