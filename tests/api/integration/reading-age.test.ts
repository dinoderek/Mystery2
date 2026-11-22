import { beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  testDatabase,
  type ApiAuthContext,
} from "./helpers";

// A game's reading age: the case's own unless the profile set one, saved on
// the session at its start. The mock narrates the opening by quoting the start
// of its prompt, which is where the age guidance sits, so the opening shows the
// age the narrator was asked to write for.

const CASE_AGE = 10; // blueprints/mock-blueprint.json

describe("a game's reading age", () => {
  let ada: ApiAuthContext;
  let grace: ApiAuthContext;

  beforeEach(async () => {
    ada = await setupApiTestAuth("reading-age-ada");
    grace = await setupApiTestAuth("reading-age-grace");
  });

  const request = (auth: ApiAuthContext, endpoint: string, body?: unknown) =>
    fetch(`${API_URL}/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: auth.headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function setAge(auth: ApiAuthContext, age: number | null) {
    const res = await request(auth, "profile-settings", { reading_age: age });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reading_age: age });
  }

  async function start(auth: ApiAuthContext) {
    const res = await request(auth, "game-start", { blueprint_id: MOCK_BLUEPRINT_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    return { gameId: body.game_id as string, readingAge: body.reading_age as number, opening: body.narration_events[0].narration_parts[0].text as string };
  }

  async function resumedAge(auth: ApiAuthContext, gameId: string): Promise<number> {
    const res = await request(auth, `game-get?game_id=${gameId}`);
    expect(res.status).toBe(200);
    return (await res.json()).reading_age;
  }

  const storedAge = (gameId: string) =>
    (testDatabase().prepare("select reading_age from game_sessions where id = ?").get(gameId) as { reading_age: number | null }).reading_age;

  it("reads at the case's own age while the profile has set none", async () => {
    expect(await (await request(ada, "profile-settings")).json()).toEqual({ reading_age: null });

    const game = await start(ada);

    expect(game.readingAge).toBe(CASE_AGE);
    expect(storedAge(game.gameId)).toBe(CASE_AGE);
    expect(game.opening).toContain(`The reader is ${CASE_AGE} `);
  });

  it("starts new games at the profile's age, and leaves a game already started at its own", async () => {
    const before = await start(ada);

    await setAge(ada, 7);
    const after = await start(ada);

    expect(after.readingAge).toBe(7);
    expect(storedAge(after.gameId)).toBe(7);
    expect(after.opening).toContain("The reader is 7 ");
    expect(await resumedAge(ada, after.gameId)).toBe(7);

    expect(storedAge(before.gameId)).toBe(CASE_AGE);
    expect(await resumedAge(ada, before.gameId)).toBe(CASE_AGE);
    const turn = await request(ada, "game-turn", { game_id: before.gameId, input: "search" });
    expect(turn.status).toBe(200);
    expect(await resumedAge(ada, before.gameId)).toBe(CASE_AGE);
  });

  it("keeps a game at the age it started with after the profile changes or clears it", async () => {
    await setAge(ada, 9);
    const game = await start(ada);

    await setAge(ada, 6);
    expect(await resumedAge(ada, game.gameId)).toBe(9);

    await setAge(ada, null);
    expect(await resumedAge(ada, game.gameId)).toBe(9);
    expect((await start(ada)).readingAge).toBe(CASE_AGE);
  });

  it("leaves every other profile at the case's own age", async () => {
    await setAge(ada, 11);

    expect(await (await request(grace, "profile-settings")).json()).toEqual({ reading_age: null });
    expect((await start(grace)).readingAge).toBe(CASE_AGE);
  });

  it("refuses an age outside the range the narrator writes for", async () => {
    for (const age of [5, 12]) {
      const res = await request(ada, "profile-settings", { reading_age: age });
      expect(res.status).toBe(400);
      expect((await res.json()).details.field).toBe("reading_age");
    }
    expect(await (await request(ada, "profile-settings")).json()).toEqual({ reading_age: null });
  });
});
