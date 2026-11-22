// A clue-graph case over HTTP on the built server: listed, started, resumed,
// and played from the snapshot saved at its start, not from today's file.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  clueGraphCaseId,
  GameGetResponseSchema,
  GameStartResponseSchema,
  GameTurnResponseSchema,
  validateClueGraph,
} from "@my2/shared";
import { API_URL, TEST_CONFIG_ROOT, patchStoredSession, readStoredEvents, sendLine, setupApiTestAuth } from "./helpers.ts";

const GREENHOUSE = clueGraphCaseId("greenhouse-prizewinner");
const FIXTURE_ID = "greenhouse-on-disk";
const FIXTURE_FILE = path.join(TEST_CONFIG_ROOT, "blueprints", "clue-graph", `${FIXTURE_ID}.json`);

function writeFixture(welly: string) {
  const graph = validateClueGraph(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "blueprints/clue-graph/greenhouse-prizewinner.json"), "utf8")),
  );
  graph.metadata.id = FIXTURE_ID;
  graph.clues.clue_welly_prints.fact = welly;
  fs.mkdirSync(path.dirname(FIXTURE_FILE), { recursive: true });
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(graph));
}

afterAll(() => fs.rmSync(FIXTURE_FILE, { force: true }));

async function start(auth: Awaited<ReturnType<typeof setupApiTestAuth>>, id: string) {
  const response = await fetch(`${API_URL}/game-start`, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({ blueprint_id: id }),
  });
  expect(response.status).toBe(200);
  return GameStartResponseSchema.parse(await response.json());
}

describe("selectable clue-graph case", () => {
  it("lists the greenhouse as its own case, after the V2 cases", async () => {
    const entries = (await (await fetch(`${API_URL}/blueprints-list`)).json()).blueprints as Array<{ id: string; title: string }>;
    const listed = entries.findIndex((entry) => entry.id === GREENHOUSE);
    expect(listed).toBeGreaterThan(entries.findIndex((entry) => entry.id === "7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47"));
    expect(entries[listed].title).toBe("The Smashed Prize Pumpkin — clue graph");
  });

  it("starts, resumes and plays from its snapshot after the file on disk changes", async () => {
    // The file is in the config root every integration file shares: it stays only as long as this test needs it.
    try {
      writeFixture("Small club-welly prints squelch through the pumpkin mush.");
      const auth = await setupApiTestAuth("clue-graph-snapshot");
      const started = await start(auth, clueGraphCaseId(FIXTURE_ID));
      expect(started.narration_events[0].payload).toMatchObject({ case_format: "clue-graph/2" });

      writeFixture("EDITED ON DISK");
      const turn = GameTurnResponseSchema.parse(await (await sendLine(auth, started.game_id, "search the smashed pumpkin")).json());
      expect(turn.kind === "turn" && turn.revealed_clues.map((clue) => clue.text)).toEqual([
        "Small club-welly prints squelch through the pumpkin mush.",
      ]);
      const stored = readStoredEvents(started.game_id).at(-1);
      expect(stored?.payload?.clue_graph).toEqual({ type: "search", spot: "the smashed pumpkin" });

      const resumed = GameGetResponseSchema.parse(
        await (await fetch(`${API_URL}/game-get?game_id=${started.game_id}`, { headers: auth.headers })).json(),
      );
      expect(resumed.state.discovered_clues?.map((clue) => clue.text)).toEqual([
        "Small club-welly prints squelch through the pumpkin mush.",
      ]);
      expect(JSON.stringify(resumed)).not.toMatch(/clue_graph_snapshot|"truth"|"conclusions"|EDITED ON DISK/);
    } finally {
      fs.rmSync(FIXTURE_FILE, { force: true });
    }
  });

  it("keeps a game saved with a clue-graph/1 snapshot listed, but will not open it", async () => {
    const auth = await setupApiTestAuth("clue-graph-retired");
    const started = await start(auth, GREENHOUSE);
    const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "blueprints/clue-graph/greenhouse-prizewinner.json"), "utf8"));
    patchStoredSession(started.game_id, { clue_graph_snapshot: JSON.stringify({ ...saved, format: "clue-graph/1" }) });

    const list = await (await fetch(`${API_URL}/game-sessions-list`, { headers: auth.headers })).json();
    expect(list.in_progress).toEqual([
      expect.objectContaining({
        game_id: started.game_id,
        mystery_title: "The Smashed Prize Pumpkin — clue graph",
        mystery_available: true,
        can_open: false,
      }),
    ]);
    const message = 'This game was saved with the case format "clue-graph/1", which is no longer read, so it cannot be opened.';
    const resumed = await fetch(`${API_URL}/game-get?game_id=${started.game_id}`, { headers: auth.headers });
    expect(resumed.status).toBe(410);
    expect(await resumed.json()).toEqual({ error: message });
    const entered = await fetch(`${API_URL}/game-enter`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: started.game_id }),
    });
    expect(entered.status).toBe(410);
    expect(await entered.json()).toEqual({ error: message });
    const turn = await sendLine(auth, started.game_id, "search the smashed pumpkin");
    expect(turn.status).toBe(410);
    expect(await turn.json()).toEqual({ error: message });
    expect(readStoredEvents(started.game_id)).toHaveLength(1);
  });

  it("marks a lead new on its turn only, and a statement taken back once it is retracted", async () => {
    const auth = await setupApiTestAuth("clue-graph-notebook");
    const started = await start(auth, GREENHOUSE);
    expect(started.state.leads?.every((lead) => lead.new)).toBe(true);

    const play = async (line: string) => {
      const answer = GameTurnResponseSchema.parse(await (await sendLine(auth, started.game_id, line)).json());
      if (answer.kind !== "turn") throw new Error(`Not a turn: ${line}`);
      return answer;
    };
    await play("search");
    await play("go to the garden");
    const greeting = await play("talk to Mr. Thorne");
    expect(greeting.leads?.filter((lead) => lead.new).map((lead) => lead.key)).toEqual(["talk:thorne"]);
    expect(greeting.taken_back).toEqual([]);

    const retraction = await play("These are your boot prints: clue_boot_prints");
    expect(retraction.taken_back).toEqual(["thorne_never_set_foot"]);
    expect(retraction.leads?.some((lead) => lead.new)).toBe(false);

    const resumed = GameGetResponseSchema.parse(
      await (await fetch(`${API_URL}/game-get?game_id=${started.game_id}`, { headers: auth.headers })).json(),
    );
    expect(resumed.state.leads).toEqual(retraction.leads);
    expect(resumed.state.discovered_clues?.find((clue) => clue.id === "thorne_never_set_foot")).toMatchObject({
      kind: "statement",
      taken_back: true,
    });
    expect(JSON.stringify([greeting, retraction, resumed])).not.toMatch(/"truth"|"rule"|toby_confession|clue_graph_snapshot/);
  });

  it("keeps the session to its owner", async () => {
    const owner = await setupApiTestAuth("clue-graph-owner");
    const other = await setupApiTestAuth("clue-graph-other");
    const started = await start(owner, GREENHOUSE);
    expect((await fetch(`${API_URL}/game-get?game_id=${started.game_id}`, { headers: other.headers })).status).toBe(404);
    expect((await sendLine(other, started.game_id, "search")).status).toBe(404);
  });
});
