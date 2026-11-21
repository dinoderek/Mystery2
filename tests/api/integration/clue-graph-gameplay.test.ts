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
import { API_URL, TEST_CONFIG_ROOT, readStoredEvents, sendLine, setupApiTestAuth } from "./helpers.ts";

const GREENHOUSE = clueGraphCaseId("greenhouse-prizewinner");
const FIXTURE_ID = "greenhouse-on-disk";
const FIXTURE_FILE = path.join(TEST_CONFIG_ROOT, "blueprints", "clue-graph", `${FIXTURE_ID}.json`);

function writeFixture(welly: string) {
  const graph = validateClueGraph(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "blueprints/clue-graph/greenhouse-prizewinner.json"), "utf8")),
  );
  graph.metadata.id = FIXTURE_ID;
  graph.clues.clue_welly_prints.text = welly;
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
    writeFixture("Small club-welly prints squelch through the pumpkin mush.");
    const auth = await setupApiTestAuth("clue-graph-snapshot");
    const started = await start(auth, clueGraphCaseId(FIXTURE_ID));
    expect(started.narration_events[0].payload).toMatchObject({ case_format: "clue-graph/1" });

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
  });

  it("keeps the session to its owner", async () => {
    const owner = await setupApiTestAuth("clue-graph-owner");
    const other = await setupApiTestAuth("clue-graph-other");
    const started = await start(owner, GREENHOUSE);
    expect((await fetch(`${API_URL}/game-get?game_id=${started.game_id}`, { headers: other.headers })).status).toBe(404);
    expect((await sendLine(other, started.game_id, "search")).status).toBe(404);
  });
});
