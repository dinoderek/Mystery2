import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalTraceSource, extractSessionTrace } from "../../../evaluation/trace/lib/datasource.ts";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.ts";
import { casesFromTrace } from "../../../evaluation/runtime/cases.ts";
import { scoreReadability } from "../../../evaluation/playtest/lib/judge.ts";
import { startOwnServer, type OwnServer } from "../../testkit/src/own-server";
import { MOCK_BLUEPRINT_ID, readStoredEvents, type ApiAuthContext } from "./helpers";

// The reading age is the profile's, read on every request: each prompt is
// written at it and each narrated event records it. This server logs every AI
// call (`AI_CALL_LOG`), so the prompts the mock was sent can be read back.
// That every prompt builder renders the age it is given is
// `tests/api/unit/reading-age.test.ts`.
//
// A profile always has an age: `/api/player` makes one only with it. One
// without (a database from before) is refused at play with a typed error.

let server: OwnServer;
let logDir: string;
let callLog: string;

beforeAll(async () => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-reading-age-"));
  callLog = path.join(logDir, "ai-calls.jsonl");
  server = await startOwnServer({ env: { AI_CALL_LOG: callLog } });
});

afterAll(async () => {
  await server?.stop();
  fs.rmSync(logDir, { recursive: true, force: true });
});

const request = (auth: ApiAuthContext, endpoint: string, body?: unknown) =>
  fetch(`${server.apiUrl}/${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: auth.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function start(auth: ApiAuthContext) {
  const res = await request(auth, "game-start", { blueprint_id: MOCK_BLUEPRINT_ID });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect((await request(auth, "game-enter", { game_id: body.game_id })).status).toBe(200);
  return { gameId: body.game_id as string, readingAge: body.reading_age as number, startPayload: body.narration_events[0].payload };
}

async function play(auth: ApiAuthContext, gameId: string, input: string) {
  const res = await request(auth, "game-turn", { game_id: gameId, input });
  expect(res.status).toBe(200);
  return res.json();
}

describe("the reading age", () => {
  let ada: ApiAuthContext;
  let grace: ApiAuthContext;

  beforeEach(async () => {
    ada = await server.createPlayer("reading-age-ada");
    grace = await server.createPlayer("reading-age-grace");
  });

  async function setAge(auth: ApiAuthContext, age: number) {
    const res = await request(auth, "profile-settings", { reading_age: age });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reading_age: age });
  }

  async function resumedAge(auth: ApiAuthContext, gameId: string): Promise<number> {
    const res = await request(auth, `game-get?game_id=${gameId}`);
    expect(res.status).toBe(200);
    return (await res.json()).reading_age;
  }

  /** The reader's age every prompt this game sent at an endpoint was written for, in call order. */
  function promptAges(gameId: string, endpoint: string): number[] {
    return fs
      .readFileSync(callLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((call) => call.game_id === gameId && call.endpoint === endpoint)
      .map((call) => Number(String(call.prompt).match(/The reader is (\d+) years old/)?.[1]));
  }

  /** Each stored event's type and the age its payload records. */
  const eventAges = (gameId: string) =>
    readStoredEvents(gameId, server.database()).map((event) => [event.event_type, event.payload?.reading_age ?? null]);

  it("writes a game at the profile's age, and records it on each narrated event", async () => {
    await setAge(ada, 8);
    const game = await start(ada);
    await play(ada, game.gameId, "search");

    expect(game.readingAge).toBe(8);
    expect(game.startPayload.reading_age).toBe(8);
    expect(promptAges(game.gameId, "game-start")).toEqual([8]);
    expect(promptAges(game.gameId, "game-enter")).toEqual([8]);
    expect(promptAges(game.gameId, "game-turn")).toEqual([8]);
    expect(eventAges(game.gameId)).toEqual([
      ["start", 8],
      ["move", 8],
      ["search", 8],
    ]);
    expect(await resumedAge(ada, game.gameId)).toBe(8);
  });

  it("writes the next turn at a changed age, and leaves earlier events at theirs", async () => {
    await setAge(ada, 8);
    const game = await start(ada);
    await play(ada, game.gameId, "search");

    await setAge(ada, 6);
    expect(await resumedAge(ada, game.gameId)).toBe(6);
    await play(ada, game.gameId, "go to the living room");

    expect(promptAges(game.gameId, "game-turn")).toEqual([8, 6]);
    expect(eventAges(game.gameId)).toEqual([
      ["start", 8],
      ["move", 8],
      ["search", 8],
      // Resuming at the new age recorded the change once (`age-command.test.ts`).
      ["age_change", null],
      ["move", 6],
    ]);
  });

  it("records no age on a line the engine wrote", async () => {
    await setAge(ada, 9);
    const game = await start(ada);
    await play(ada, game.gameId, "help");
    await play(ada, game.gameId, "dance");

    expect(eventAges(game.gameId).slice(2)).toEqual([
      ["no_turn_line", null],
      ["no_turn_line", null],
    ]);
  });

  it("writes a profile's first game at the age it was created with", async () => {
    const reader = await server.createPlayer("created-at-11", 11);
    expect(await (await request(reader, "profile-settings")).json()).toEqual({ reading_age: 11 });

    const game = await start(reader);
    await play(reader, game.gameId, "search");

    expect(game.readingAge).toBe(11);
    expect(game.startPayload.reading_age).toBe(11);
    expect(promptAges(game.gameId, "game-start")).toEqual([11]);
    expect(promptAges(game.gameId, "game-turn")).toEqual([11]);
  });

  describe("a profile with no age (a database from before)", () => {
    const clearAge = (auth: ApiAuthContext) =>
      server.database().prepare("update players set reading_age = null where id = ?").run(auth.id);
    const modelCalls = () => (fs.existsSync(callLog) ? fs.readFileSync(callLog, "utf8").split("\n").filter(Boolean).length : 0);
    const sessionCount = (auth: ApiAuthContext) =>
      Number(server.database().prepare("select count(*) as n from game_sessions where player_id = ?").get(auth.id)?.n);

    async function expectRequired(res: Response) {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Choose a reading age before playing",
        details: { code: "READING_AGE_REQUIRED" },
      });
    }

    it("is refused a new game with the typed error, and nothing is saved", async () => {
      clearAge(ada);
      const callsBefore = modelCalls();

      await expectRequired(await request(ada, "game-start", { blueprint_id: MOCK_BLUEPRINT_ID }));

      expect(sessionCount(ada)).toBe(0);
      expect(modelCalls()).toBe(callsBefore);
    });

    it("is refused a turn and the arrival, saving no event, until it chooses an age", async () => {
      const started = await request(ada, "game-start", { blueprint_id: MOCK_BLUEPRINT_ID });
      const { game_id: gameId } = await started.json();
      clearAge(ada);

      await expectRequired(await request(ada, "game-enter", { game_id: gameId }));
      await expectRequired(await request(ada, "game-turn", { game_id: gameId, input: "search" }));
      expect(eventAges(gameId)).toEqual([["start", 8]]);

      await setAge(ada, 9);
      expect((await request(ada, "game-enter", { game_id: gameId })).status).toBe(200);
      await play(ada, gameId, "search");
      expect(eventAges(gameId)).toEqual([
        ["start", 8],
        ["age_change", null], // the opening was written at 8, the arrival at 9
        ["move", 9],
        ["search", 9],
      ]);
    });

    it("answers the settings page with the same error, and takes an age by POST", async () => {
      clearAge(ada);

      await expectRequired(await request(ada, "profile-settings"));
      await setAge(ada, 10);
      expect(await (await request(ada, "profile-settings")).json()).toEqual({ reading_age: 10 });
      expect((await start(ada)).readingAge).toBe(10);
    });
  });

  it("leaves every other profile at its own age", async () => {
    await setAge(ada, 11);
    await setAge(grace, 7);

    expect((await start(grace)).readingAge).toBe(7);
    expect((await start(ada)).readingAge).toBe(11);
  });

  it("refuses an age outside the range the narrator writes for", async () => {
    for (const age of [5, 12]) {
      const res = await request(ada, "profile-settings", { reading_age: age });
      expect(res.status).toBe(400);
      expect((await res.json()).details.field).toBe("reading_age");
    }
    expect(await (await request(ada, "profile-settings")).json()).toEqual({ reading_age: 8 });
  });

  it("refuses a null age: a profile's age cannot be cleared", async () => {
    const res = await request(ada, "profile-settings", { reading_age: null });

    expect(res.status).toBe(400);
    expect((await res.json()).details.field).toBe("reading_age");
    expect(await (await request(ada, "profile-settings")).json()).toEqual({ reading_age: 8 });
  });
});

// The menu's lines are narrated on request at the profile's age then, and never
// kept: each visit asks the narrator again.
describe("the menu's lines", () => {
  const menuPromptAges = () =>
    fs
      .readFileSync(callLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((call) => call.endpoint === "blueprints-list")
      .map((call) => Number(String(call.prompt).match(/The reader is (\d+) years old/)?.[1]));

  it("are asked anew on every visit, at the age the profile has then", async () => {
    const reader = await server.createPlayer("menu-lines");
    const visit = async (age: number) => {
      expect((await request(reader, "profile-settings", { reading_age: age })).status).toBe(200);
      const res = await request(reader, "blueprints-list?one_liners=true");
      expect(res.status).toBe(200);
      const { blueprints } = await res.json();
      expect(blueprints.find((entry: { id: string }) => entry.id === MOCK_BLUEPRINT_ID)?.one_liner).toMatch(/^\[Mock\] /);
    };
    const before = fs.existsSync(callLog) ? menuPromptAges().length : 0;

    await visit(7);
    await visit(10);
    await visit(10);

    expect(menuPromptAges().slice(before)).toEqual([7, 10, 10]);
  });
});

// The evaluation readers take each turn's age from its own event in a game as
// played: trace extraction, runtime cases and playtest's reading level. Each
// reader's refusal of an event without one is its own unit test.
describe("a played game, read back for evaluation", () => {
  it("is judged turn by turn at the age each event records, across a change", async () => {
    const reader = await server.createPlayer("evaluation-ages");
    expect((await request(reader, "profile-settings", { reading_age: 8 })).status).toBe(200);
    const game = await start(reader);
    await play(reader, game.gameId, "search");
    expect((await request(reader, "profile-settings", { reading_age: 6 })).status).toBe(200);
    await play(reader, game.gameId, "go to the living room");
    await play(reader, game.gameId, "age 10");
    await play(reader, game.gameId, "search");

    const source = createLocalTraceSource({ databasePath: server.databaseFile, repoRoot: process.cwd(), env: {} });
    const trace = await extractSessionTrace(source, game.gameId).finally(() => source.close?.());

    // The opening is no game master's turn, so its record holds no age; playtest scores it at its event's.
    const turns = reconstructTrace(trace).turns.map((turn) => [turn.event_type, turn.reading_age]);
    expect(turns).toEqual([["start", null], ["move", 8], ["search", 8], ["move", 6], ["search", 10]]);

    const cases = casesFromTrace(trace, ["move", "search"], 10, "case.json", ["flesch"]);
    expect(cases.map((turnCase) => [turnCase.id, turnCase.reading_age])).toEqual([
      ["s2-move", 8],
      ["s3-search", 8],
      ["s5-move", 6],
      ["s7-search", 10],
    ]);

    expect(scoreReadability(trace).narrations.map((graded) => [graded.event_type, graded.reading_age])).toEqual([
      ["start", 8],
      ...turns.slice(1),
    ]);
  });
});

// Engine-written lines are one fixed text for every age: only the narrator
// writes at the reader's age.
describe("the lines the engine writes", () => {
  // The opening tip, help, errors, the accusation's rule and the way back, three
  // failures to a loss, and a line once the case has ended.
  const SCRIPT = ["help", "dance", "age 12", "search", "accuse", "back", ...Array(3).fill("accuse Bob did it."), "search"];

  /** Every line the engine wrote, and every lead, that a player at `age` reads through SCRIPT. */
  async function engineLines(age: number) {
    const auth = await server.createPlayer(`engine-lines-${age}`);
    expect((await request(auth, "profile-settings", { reading_age: age })).status).toBe(200);
    const started = await (await request(auth, "game-start", { blueprint_id: MOCK_BLUEPRINT_ID })).json();
    expect((await request(auth, "game-enter", { game_id: started.game_id })).status).toBe(200);
    const system = (events: { narration_parts: { text: string; speaker: { kind: string } }[] }[]) =>
      events.flatMap((event) => event.narration_parts).filter((part) => part.speaker.kind === "system").map((part) => part.text);

    // The opening's second part is the engine's notebook tip, saved beside the narration.
    const tip = started.narration_events[0].narration_parts[1].text;
    expect(tip).toMatch(/^Tip: /);

    const lines: unknown[] = [["start", tip, started.state.leads]];
    for (const input of SCRIPT) {
      const answer = await (await request(auth, "game-turn", { game_id: started.game_id, input })).json();
      if (answer.kind === "turn") lines.push([input, system(answer.events), answer.leads, answer.result]);
      else lines.push([input, answer.kind, answer.hint ?? answer.note ?? null]);
    }
    const narratedAt = readStoredEvents(started.game_id, server.database()).flatMap((event) => event.payload?.reading_age ?? []);
    return { lines, narratedAt: [...new Set(narratedAt)] };
  }

  it("leads, the tip, help, errors and the end of the case read the same at 6 and at 11", async () => {
    const young = await engineLines(6);
    const old = await engineLines(11);

    expect(young.narratedAt).toEqual([6]);
    expect(old.narratedAt).toEqual([11]);
    expect(old.lines).toEqual(young.lines);
    // The script reached each kind of line it is meant to compare.
    expect(young.lines.flat(2)).toEqual(
      expect.arrayContaining([
        "Help menu opened.",
        expect.stringContaining("from 6 to 11"),
        expect.stringContaining("accusations left"),
        expect.stringContaining("You put the accusation aside"),
        "lose",
        expect.stringMatching(/^Commands: notebook, age <number>, help, quit/),
      ]),
    );
  });
});

// Signing in: a name nobody has yet makes a profile, which needs its age.
describe("creating a profile", () => {
  const signIn = (body: unknown) =>
    fetch(`${server.apiUrl}/player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const uniqueName = () => `signin-${crypto.randomUUID().slice(0, 8)}`;
  const storedAge = (name: string) =>
    server.database().prepare("select reading_age from players where name = ?").get(name)?.reading_age;

  it("refuses a new name without an age, or with one out of range, and makes no profile", async () => {
    const name = uniqueName();

    for (const body of [{ name }, { name, reading_age: 5 }, { name, reading_age: 12 }, { name, reading_age: "9" }, { name, reading_age: null }]) {
      const res = await signIn(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toMatch(/reading_age/);
    }
    expect(storedAge(name)).toBeUndefined();
  });

  it("creates a profile holding the age it was given", async () => {
    const name = uniqueName();

    const res = await signIn({ name, reading_age: 11 });

    expect(res.status).toBe(200);
    expect((await res.json()).player.name).toBe(name);
    expect(storedAge(name)).toBe(11);
  });

  it("signs an existing name in with the name alone, and leaves its age as it was", async () => {
    const name = uniqueName();
    await signIn({ name, reading_age: 7 });

    const res = await signIn({ name });

    expect(res.status).toBe(200);
    expect(storedAge(name)).toBe(7);
    const again = await signIn({ name, reading_age: 10 });
    expect(again.status).toBe(200);
    expect(storedAge(name)).toBe(7);
  });

  it("refuses a missing name", async () => {
    expect((await signIn({ reading_age: 8 })).status).toBe(400);
    expect((await signIn({ name: "   ", reading_age: 8 })).status).toBe(400);
  });
});
