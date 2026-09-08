import { describe, expect, it } from "vitest";

import {
  PLAYER_COOKIE_PREFIX,
  playerCookieName,
} from "../../../packages/game-engine/src/player-cookie.ts";

describe("playerCookieName", () => {
  it("gives two databases different cookies", () => {
    // The bug this exists for: cookies are not isolated by port, so two
    // servers on `localhost` shared one profile. Whichever was used last won,
    // and the other 401'd every request while still showing a signed-in menu.
    const worktree = playerCookieName("/cfg/database/roblox-dev-workflow/game.db");
    const main = playerCookieName("/cfg/database/main/game.db");

    expect(worktree).not.toBe(main);
  });

  it("gives one database the same cookie across restarts", () => {
    const path = "/cfg/database/main/game.db";

    expect(playerCookieName(path)).toBe(playerCookieName(path));
  });

  it("resolves relative paths, so the same file is one cookie", () => {
    // A server started from `web/` and a script started from the repo root
    // reach the same database by different spellings.
    expect(playerCookieName("/cfg/database/main/game.db")).toBe(
      playerCookieName("/cfg/database/other/../main/game.db"),
    );
  });

  it("is a valid cookie name whatever the database is called", () => {
    // A database name is a path segment, which permits plenty that a cookie
    // name does not — spaces and `;` among them.
    const name = playerCookieName("/cfg/database/a name; with=separators/game.db");

    expect(name.startsWith(`${PLAYER_COOKIE_PREFIX}.`)).toBe(true);
    expect(name).toMatch(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/);
  });
});
