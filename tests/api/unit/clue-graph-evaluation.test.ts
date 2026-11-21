// The evaluation tools reading a clue-graph case (`docs/clue-graph.md`): trace
// extraction of a game played on the mock, its reconstruction and mechanical
// checks, the runtime harness's case loading, roles and seeding, self-play's
// case lookup, and what the game-master judges are told.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clueGraphCaseId, GameStartResponseSchema, GameTurnResponseSchema } from "@my2/shared";
import { createLocalEngine, type LocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { handle as startGame } from "../../../packages/game-engine/src/endpoints/game-start.ts";
import { playTurn } from "../../../packages/game-engine/src/turn/play-turn.ts";
import { composeGameMasterUserMessage as composeJudgeUserMessage } from "../../../evaluation/judges/clue-graph-guidance.ts";
import { projectInteractionSubject, projectTraceSubject } from "../../../evaluation/judges/subject.ts";
import { findBlueprint } from "../../../evaluation/playtest/play.ts";
import { countBlueprintClues } from "../../../evaluation/playtest/lib/output.ts";
import { readBlueprint, type TurnCase } from "../../../evaluation/runtime/lib/case.ts";
import { outputSays } from "../../../evaluation/runtime/lib/expect.ts";
import { casesFromTrace } from "../../../evaluation/runtime/cases.ts";
import { buildRoleRequest } from "../../../evaluation/runtime/lib/prompt-build.ts";
import { getAction, normalizeHistory, resolveRoleName } from "../../../evaluation/runtime/lib/roles.ts";
import { seedSessionWithHistory } from "../../../evaluation/runtime/lib/seed.ts";
import { createLocalTraceSource, extractSessionTrace } from "../../../evaluation/trace/lib/datasource.ts";
import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.ts";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.ts";
import type { RawTrace } from "../../../evaluation/trace/lib/normalize.ts";
import { makeBlueprint } from "./trace-fixtures.ts";

const ROOT = process.cwd();
const GREENHOUSE_FILE = "blueprints/clue-graph/greenhouse-prizewinner.json";
const GREENHOUSE_ID = clueGraphCaseId("greenhouse-prizewinner");
const silent = { log: () => {}, logError: () => {} };

const WIN = [
  "search the smashed pumpkin",
  "go to the workshop",
  "talk to Mr. Dobbs",
  "What about the noise last night?",
  "bye",
  "go to the garden",
  "talk to Mr. Thorne",
  "bye",
  "accuse",
  "It was Toby.",
  "Toby did it: his welly prints are in the pumpkin.",
];

describe("a clue-graph game, extracted and judged", () => {
  let scratch: string;
  let local: LocalEngine;
  let ctx: EngineContext;
  let databasePath: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "clue-graph-eval-"));
    databasePath = path.join(scratch, "test.db");
    local = createLocalEngine({ repoRoot: ROOT, env: { MYSTERY_CONFIG_ROOT: scratch }, databasePath });
    ctx = local.contextFor({ id: local.players.ensure("Graph evaluator").id });
  });
  afterEach(() => {
    local.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function playOnMock(lines: string[]): Promise<string> {
    const started = await startGame(
      new Request("http://test/api/game-start", { method: "POST", body: JSON.stringify({ blueprint_id: GREENHOUSE_ID }) }),
      ctx,
    );
    const { game_id: gameId } = GameStartResponseSchema.parse(await started.json());
    for (const input of lines) {
      const turn = GameTurnResponseSchema.parse(
        await playTurn(ctx, { game_id: gameId, input }, { req: new Request("http://test/api/game-turn"), request_id: "test", logger: silent }),
      );
      expect(turn.kind, input).toBe("turn");
    }
    return gameId;
  }

  async function extract(gameId: string): Promise<RawTrace> {
    const source = createLocalTraceSource({ databasePath, repoRoot: ROOT, env: {} });
    try {
      return await extractSessionTrace(source, gameId);
    } finally {
      source.close?.();
    }
  }

  it("extracts the snapshot's graph, its format revision and what the player earned", async () => {
    const trace = await extract(await playOnMock(WIN));
    expect(trace.clue_graph).toMatchObject({ format: "clue-graph/1", revision: 1, progress: { culprit_supported: true } });
    expect(trace.clue_graph?.progress.supported_conclusions.length).toBeGreaterThan(0);
    expect(trace.blueprint.clue_graph?.metadata.id).toBe("greenhouse-prizewinner");
    // The case is the private snapshot: its world view carries no V2 reasoning paths.
    expect(trace.blueprint.solution_paths).toEqual([]);
    expect(trace.events.some((event) => event.payload?.clue_graph)).toBe(true);
  });

  it("extracts a game on the snapshot, not on the file as it is now", async () => {
    const gameId = await playOnMock(["search the smashed pumpkin"]);
    local.db.prepare("update game_sessions set clue_graph_snapshot = replace(clue_graph_snapshot, 'The Greenhouse', 'The Old Greenhouse') where id = ?").run(gameId);
    const trace = await extract(gameId);
    expect(trace.blueprint.clue_graph?.locations.greenhouse.name).toBe("The Old Greenhouse");
  });

  it("rebuilds each turn's context from the graph and the events, with no errors", async () => {
    const trace = await extract(await playOnMock(WIN));
    const reconstruction = reconstructTrace(trace);
    expect(reconstruction.issues).toEqual([]);
    const talks = reconstruction.turns.filter((turn) => turn.role_name === "graph_talk");
    expect(talks.length).toBeGreaterThanOrEqual(3);
    for (const turn of talks) expect(turn.reconstructed_context?.graph_talk_context, `turn ${turn.sequence}`).toBeDefined();
    expect(talks[0].character_id).toBe("dobbs");
    const search = reconstruction.turns.find((turn) => turn.event_type === "search");
    expect(search?.reconstructed_context?.graph_search_context).toBeDefined();
    const judge = reconstruction.turns.filter((turn) => turn.role_name === "accusation_judge").at(-1);
    expect(judge?.reconstructed_context?.accusation_judge_context?.clue_graph_progress).toBeDefined();
  });

  it("accounts a played game's clues by the engine's rules, and flags one that was not offered", async () => {
    const trace = await extract(await playOnMock(WIN));
    const passing = runTraceMechanicalChecks({ rawTrace: trace });
    expect(passing.map((check) => [check.id, check.status])).toEqual([["clue_accounting", "pass"], ["spoiler_leak", "pass"]]);

    const search = trace.events.find((event) => event.event_type === "search")!;
    const forged = structuredClone(trace);
    const target = forged.events.find((event) => event.sequence === search.sequence)!;
    target.payload = { ...target.payload, revealed_clue_ids: ["toby_confession"], revealed_clue_id: "toby_confession" };
    const failing = runTraceMechanicalChecks({ rawTrace: forged }).find((check) => check.id === "clue_accounting");
    expect(failing?.status).toBe("fail");
    expect(JSON.stringify(failing?.details)).toContain("clue_not_available");
  });

  it("turns the played game into runtime cases that keep the recorded play and build their prompts", async () => {
    const trace = await extract(await playOnMock(WIN));
    const cases = casesFromTrace(trace as never, ["talk", "ask"], 3, "case.json", ["flesch"]);
    expect(cases.length).toBeGreaterThan(0);
    for (const turnCase of cases) {
      const recorded = (turnCase.given.history ?? []).filter((row) => row.payload?.clue_graph !== undefined);
      expect(recorded.length, turnCase.id).toBeGreaterThan(0);
      const action = getAction(turnCase.action.type);
      const input = action.roleInput(turnCase.given, turnCase.action, trace.blueprint as never, normalizeHistory(turnCase.given.history));
      expect(input.role).toBe("graph_talk");
      await expect(buildRoleRequest(input as never)).resolves.toMatchObject({ context: { role_name: "graph_talk" } });
    }
  });

  it("projects the greeting's first words as clues the player already held", async () => {
    const trace = await extract(await playOnMock(WIN));
    const subject = projectTraceSubject(reconstructTrace(trace).turns);
    const asked = subject.turns.find((turn) => turn.role_name === "graph_talk" && turn.player_input);
    const greeting = subject.turns.find((turn) => turn.role_name === "graph_talk" && !turn.player_input);
    expect(greeting?.revealed_clue_ids).toContain("dobbs_rounds");
    expect(asked?.prior_revealed_clue_ids).toContain("dobbs_rounds");
  });
});

describe("what the game-master judges are told", () => {
  const GM = ["gm_roleplay", "gm_clue_discipline", "gm_fabrication", "gm_spoiler", "gm_broad"];

  it.each(GM)("%s is handed the graph guidance for a clue-graph blueprint", async (id) => {
    const { blueprint } = await readBlueprint(GREENHOUSE_FILE, ROOT);
    const message = JSON.parse(composeJudgeUserMessage(id, null, { blueprint, subject: { turns: [] } }));
    expect(message.format_guidance).toContain("blueprint.clue_graph is the authority");
    expect(message.format_guidance).toContain("physical");
    expect(Object.keys(message)).toEqual(["dimension_id", "context", "format_guidance", "blueprint", "subject"]);
  });

  it("each judge's guidance speaks to its own question", async () => {
    const { blueprint } = await readBlueprint(GREENHOUSE_FILE, ROOT);
    const says = (id: string) => JSON.parse(composeJudgeUserMessage(id, null, { blueprint, subject: {} })).format_guidance as string;
    expect(says("gm_clue_discipline")).toContain("Clue discipline");
    expect(says("gm_spoiler")).toContain("every false statement's \"why\"");
    expect(says("gm_fabrication")).toContain("Fabrication");
    expect(says("gm_roleplay")).toContain("demeanor");
  });

  it("leaves every other blueprint and every other judge's message as it was", () => {
    const blueprint = makeBlueprint();
    for (const id of GM) {
      expect(JSON.parse(composeJudgeUserMessage(id, null, { blueprint, subject: {} }))).not.toHaveProperty("format_guidance");
    }
    expect(JSON.parse(composeJudgeUserMessage("solve_depth", null, { blueprint: { clue_graph: {} } }))).not.toHaveProperty("format_guidance");
  });
});

describe("the runtime harness on a clue-graph case", () => {
  it("loads the case file as the game does, with its graph beside the world view", async () => {
    const { blueprint } = await readBlueprint(GREENHOUSE_FILE, ROOT);
    expect(blueprint.id).toBe(GREENHOUSE_ID);
    expect(blueprint.clue_graph?.format).toBe("clue-graph/1");
    expect(blueprint.world.characters.map((character) => character.id)).toContain("toby");
  });

  it("replays a clue-graph talk, line and search through the graph roles, and labels them as the game saves them", async () => {
    const { blueprint } = await readBlueprint(GREENHOUSE_FILE, ROOT);
    const given = { mode: "explore", location_id: "potting_shed", time_remaining: 8 };
    expect(resolveRoleName("talk", given, { type: "talk", character_id: "toby" }, blueprint, [])).toBe("graph_talk");
    expect(resolveRoleName("ask", { ...given, mode: "talk", talk_character_id: "toby" }, { type: "ask", player_input: "Hi" }, blueprint, [])).toBe("graph_talk");
    expect(resolveRoleName("search", given, { type: "search", search_query: "the pegs" }, blueprint, [])).toBe("search");
  });

  it("reads what a clue-graph talk reply opened and answered", () => {
    const turn = {
      action: { type: "ask" },
      response: { raw: { narration: "Hm.", opened: ["toby_blames_mia"], answered: ["toby_no_key"], input_understood: true } },
    } as unknown as Parameters<typeof outputSays>[0];
    expect(outputSays(turn)).toEqual({ revealed: ["toby_blames_mia", "toby_no_key"], used: [], understood: true });
  });

  it("seeds the private snapshot beside the session, so the server plays the case and not the file", async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "clue-graph-seed-"));
    try {
      const databaseFile = path.join(scratch, "game.db");
      const db = openDatabase({ path: databaseFile });
      const now = new Date().toISOString();
      db.prepare("insert into players (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("p1", "seeded", now, now);
      db.close();
      const { blueprint } = await readBlueprint(GREENHOUSE_FILE, ROOT);
      const gameId = seedSessionWithHistory({
        databaseFile,
        blueprint,
        given: { mode: "explore", location_id: "greenhouse", time_remaining: 12, history: [] },
        aiProfile: "mock",
        playerName: "seeded",
      });
      const read = openDatabase({ path: databaseFile, readonly: true });
      const row = read.prepare("select blueprint_id, clue_graph_snapshot, msf_snapshot from game_sessions where id = ?").get(gameId) as Record<string, string | null>;
      read.close();
      expect(row.blueprint_id).toBe(GREENHOUSE_ID);
      expect(row.msf_snapshot).toBeNull();
      expect(JSON.parse(row.clue_graph_snapshot as string)).toEqual(blueprint.clue_graph);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("builds a judge subject whose history carries a clue-graph greeting's first words", async () => {
    const subject = projectInteractionSubject(
      {
        given: {
          location_id: "workshop",
          talk_character_id: "dobbs",
          history: [
            { event_type: "talk", narration: "Mr. Dobbs looks up.", payload: { character_id: "dobbs", revealed_clue_ids: ["dobbs_rounds"], clue_graph: { type: "talk", character: "dobbs" } } },
          ],
        },
        action: { player_input: "What about the noise?" },
        response: { raw: { narration: "He frowns.", opened: [], answered: ["clue_dobbs_crash_time"] }, narration_text: "He frowns." },
      },
      { roleName: "graph_talk" },
    );
    expect(subject.turns[1].prior_revealed_clue_ids).toEqual(["dobbs_rounds"]);
    expect(subject.turns[1].revealed_clue_ids).toEqual(["clue_dobbs_crash_time"]);
  });
});

describe("self-play's case lookup", () => {
  const roots = path.join(ROOT, "blueprints");
  it.each([
    ["a path", GREENHOUSE_FILE],
    ["its ID", GREENHOUSE_ID],
    ["its file name", "greenhouse-prizewinner"],
    ["its title", "The Smashed Prize Pumpkin — clue graph"],
  ])("finds the greenhouse case by %s", (_how, query) => {
    const found = findBlueprint(query, roots, "");
    expect(found.blueprint.id).toBe(GREENHOUSE_ID);
    expect(found.blueprint.clue_graph?.metadata.id).toBe("greenhouse-prizewinner");
    expect(path.basename(found.file)).toBe("greenhouse-prizewinner.json");
  });

  it("counts the notebook's clues, not the tells no clue depends on", async () => {
    const { blueprint } = await readBlueprint(GREENHOUSE_FILE, ROOT);
    const graph = blueprint.clue_graph!;
    const total = countBlueprintClues({ ...blueprint, clue_graph: graph } as never);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(Object.keys(graph.clues).length);
  });
});

export type { TurnCase };
