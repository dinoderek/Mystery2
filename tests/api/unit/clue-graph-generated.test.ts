// The generated stories in `blueprints/clue-graph/`: each has the size and
// reading age of the brief it was written from, passes the validator at that
// size, and is won on the mock
// narrator through the real turn, by the shortest route to the culprit without
// the confession and an accusation that cites one of its clues.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GameStartResponseSchema,
  GameTurnResponseSchema,
  clueGraphCaseId,
  culpritRoutes,
  validateClueGraph,
  type ClueGraphCase,
} from "@my2/shared";
import { ClueGraphBriefSchema } from "../../../packages/blueprint-generator/src/clue-graph-brief.ts";
import { createLocalEngine, type LocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import { handle as startGame } from "../../../packages/game-engine/src/endpoints/game-start.ts";
import { playTurn } from "../../../packages/game-engine/src/turn/play-turn.ts";
import { confessionClues } from "../../../packages/game-engine/src/clue-graph/accusation.ts";
import { linesFor, plan } from "./fixtures/clue-graph-mock-route.ts";

const ROOT = process.cwd();
const silent = { log: () => {}, logError: () => {} };

/** Each generated story and the brief it was generated from. */
const STORIES = [
  { file: "blueprints/clue-graph/missing-blue-rosette.json", brief: "blueprints/clue-graph/briefs/dog-show-rosette.brief.json" },
  { file: "blueprints/clue-graph/midnight-train.json", brief: "blueprints/clue-graph/briefs/museum-sleepover-train.brief.json" },
  { file: "blueprints/clue-graph/the-stopped-clock.json", brief: "blueprints/clue-graph/briefs/clock-tower-key.brief.json" },
];

const load = (file: string): ClueGraphCase => validateClueGraph(JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")));

describe.each(STORIES)("the generated story $file", ({ file, brief }) => {
  const graph = load(file);
  let scratch: string;
  let local: LocalEngine;
  let ctx: EngineContext;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "clue-graph-generated-"));
    local = createLocalEngine({ repoRoot: ROOT, env: { MYSTERY_CONFIG_ROOT: scratch }, databasePath: path.join(scratch, "test.db") });
    ctx = local.contextFor({ id: local.players.ensure("Generated investigator", 8).id });
  });
  afterAll(() => {
    local.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("has its brief's size, and passes the validator at that size", () => {
    const asked = ClueGraphBriefSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, brief), "utf8")));
    // The size's own counts, none set apart: `validateClueGraph` (in `load`) has already held the case to them.
    expect(graph.metadata).toMatchObject({ size: asked.size });
    expect(asked.sizeOverrides).toBeUndefined();
    expect(graph.metadata.size_overrides).toBeUndefined();
  });

  it("is won on the mock by the shortest route without the confession, citing one of its clues", async () => {
    const [route] = culpritRoutes(graph)
      .flatMap((entry) => (entry.confession || entry.turns === null ? [] : [{ ...entry, turns: entry.turns }]))
      .sort((a, b) => a.turns - b.turns);
    // The engine's confession (what wins outright) is left out. The validator
    // costs this route leaving out more (`clue-graph-story.ts`), so a cheaper
    // plan can only fail the length check below, never pass falsely.
    const actions = plan(graph, route.clues, new Set(confessionClues(graph)));
    // The plan costs what the validator's route search says this route costs.
    expect(actions).toHaveLength(route.turns);
    const lines = linesFor(graph, actions);

    const started = GameStartResponseSchema.parse(
      await (await startGame(new Request("http://test/api/game-start", { method: "POST", body: JSON.stringify({ blueprint_id: clueGraphCaseId(graph.metadata.id) }) }), ctx)).json(),
    );
    const play = async (input: string) => {
      const turn = GameTurnResponseSchema.parse(
        await playTurn(ctx, { game_id: started.game_id, input }, { req: new Request("http://test/api/game-turn"), request_id: "test", logger: silent }),
      );
      if (turn.kind !== "turn") throw new Error(`Not a turn: ${input}: ${JSON.stringify(turn)}`);
      return turn;
    };
    const found = new Set<string>();
    let last = started.state.time_remaining;
    for (const line of lines) {
      const turn = await play(line);
      for (const clue of turn.revealed_clues) found.add(clue.id);
      last = turn.state.time_remaining;
    }
    // The engine charged the turns the plan says, and no more.
    expect(last).toBe(graph.metadata.time_budget - route.turns);
    expect([...found]).toEqual(expect.arrayContaining(route.clues));
    // Won on the route, not on a confession that came out along the way.
    expect([...found].filter((id) => confessionClues(graph).includes(id))).toEqual([]);

    await play("accuse");
    const culprit = Object.values(graph.characters).find((person) => person.role === "culprit")!;
    const verdict = await play(`It was ${culprit.name}: ${route.clues[0]}`);
    expect(verdict.result).toBe("win");
  });
});
