// A clue-graph case played through the real handlers and turn, in process, on
// a throwaway database: the catalog, the private snapshot, talk and search
// turns judged against the derived state, and reports the state did not offer
// failing before anything is saved.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameGetResponseSchema,
  GameStartResponseSchema,
  GameTurnResponseSchema,
  clueGraphCaseId,
  validateClueGraph,
  type ClueGraphCase,
} from "@my2/shared";
import { createLocalEngine, type LocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import { createAIProviderFromProfile, type AIProvider, type AIRoleOutputRequest } from "../../../packages/game-engine/src/ai-provider.ts";
import { handle as startGame } from "../../../packages/game-engine/src/endpoints/game-start.ts";
import { handle as getGame } from "../../../packages/game-engine/src/endpoints/game-get.ts";
import { handle as listSessions } from "../../../packages/game-engine/src/endpoints/game-sessions-list.ts";
import { playTurn } from "../../../packages/game-engine/src/turn/play-turn.ts";
import { RetriableAIError } from "../../../packages/game-engine/src/errors.ts";
import { clueGraphEvents } from "../../../packages/game-engine/src/clue-graph/history.ts";
import { deriveClueGraph } from "../../../packages/game-engine/src/clue-graph/leads.ts";

const ROOT = process.cwd();
const GREENHOUSE = path.join(ROOT, "blueprints/clue-graph/greenhouse-prizewinner.json");
const silent = { log: () => {}, logError: () => {} };
type Profile = Parameters<typeof createAIProviderFromProfile>[0];

function greenhouse(): ClueGraphCase {
  return validateClueGraph(JSON.parse(fs.readFileSync(GREENHOUSE, "utf8")));
}

/**
 * The greenhouse with what it lacks: the water butt hidden until Toby's hand
 * goes to his pocket, and Mr. Thorne's ladder gate physical.
 */
function fixture(): ClueGraphCase {
  const graph = greenhouse();
  graph.metadata.id = "greenhouse-fixture";
  const butt = graph.locations.greenhouse.spots.find((spot) => spot.name === "the water butt by the door")!;
  butt.revealed_by = "react_toby_pocket";
  const ladder = graph.clues.thorne_ladder_thursday;
  if (ladder.kind !== "statement" || ladder.reached.by !== "gated") throw new Error("The ladder clue is gated");
  ladder.reached.gate.physical = true;
  graph.clues.react_toby_wellies = {
    kind: "tell",
    text: "Toby tucks his feet under the bench.",
    source: { character: "toby" },
    reached: { by: "seen", subject: "wellies" },
  };
  return validateClueGraph(graph);
}

/** A narrator that answers every structured role with `answer`, and narrates as the mock does. */
function answering(answer: (request: AIRoleOutputRequest<unknown>) => Record<string, unknown>) {
  return (profile: Profile): AIProvider => {
    const inner = createAIProviderFromProfile(profile);
    return {
      profile: inner.profile,
      resolvedModel: inner.resolvedModel,
      generateNarration: inner.generateNarration.bind(inner),
      generateRoleOutput: async (request) => request.parse(answer(request as AIRoleOutputRequest<unknown>)),
    };
  };
}

function reporting(opened: string[], answered: string[] = []) {
  return answering(() => ({ narration: "A line.", opened, answered, input_understood: true }));
}

describe("clue-graph sessions and turns", () => {
  let scratch: string;
  let local: LocalEngine;
  let ctx: EngineContext;
  let databasePath: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "clue-graph-play-"));
    databasePath = path.join(scratch, "test.db");
    local = createLocalEngine({ repoRoot: ROOT, env: { MYSTERY_CONFIG_ROOT: scratch }, databasePath });
    ctx = local.contextFor({ id: local.players.ensure("Graph investigator").id });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    local.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function start(id: string) {
    const response = await startGame(
      new Request("http://test/api/game-start", { method: "POST", body: JSON.stringify({ blueprint_id: id }) }),
      ctx,
    );
    expect(response.status).toBe(200);
    return GameStartResponseSchema.parse(await response.json());
  }

  async function play(gameId: string, input: string, createProvider?: (profile: Profile) => AIProvider) {
    const result = GameTurnResponseSchema.parse(
      await playTurn(ctx, { game_id: gameId, input }, {
        req: new Request("http://test/api/game-turn"),
        request_id: "test",
        logger: silent,
        createProvider,
      }),
    );
    if (result.kind !== "turn") throw new Error(`Not a turn: ${input}: ${JSON.stringify(result)}`);
    return result;
  }

  function installed(graph: ClueGraphCase): string {
    const dir = path.join(scratch, "blueprints/clue-graph");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${graph.metadata.id}.json`);
    fs.writeFileSync(file, JSON.stringify(graph));
    return file;
  }

  async function derived(gameId: string) {
    const graph = (await ctx.sessions.getById(gameId))!.clue_graph_snapshot!;
    return { graph, events: clueGraphEvents(await ctx.events.listBySession(gameId)) };
  }

  it("lists the greenhouse after the V2 cases and pins it to the session", async () => {
    const entries = await ctx.content.listBlueprints(silent);
    const index = entries.findIndex((entry) => entry.blueprint.id === clueGraphCaseId("greenhouse-prizewinner"));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(entries.slice(index).every((entry) => entry.blueprint.schema_version !== "v2")).toBe(true);
    expect(entries[index].blueprint.metadata.title).toBe("The Smashed Prize Pumpkin — clue graph");

    const started = await start(clueGraphCaseId("greenhouse-prizewinner"));
    expect(started.narration_events[0].payload).toMatchObject({ case_format: "clue-graph/1" });
    expect((await ctx.sessions.getById(started.game_id))?.clue_graph_snapshot).toEqual(greenhouse());
    const v2 = await start("123e4567-e89b-12d3-a456-426614174000");
    expect((await ctx.sessions.getById(v2.game_id))?.clue_graph_snapshot).toBeUndefined();
  });

  it("resumes and plays from the snapshot after the file on disk is edited", async () => {
    const graph = fixture();
    const file = installed(graph);
    const opened = await start(clueGraphCaseId(graph.metadata.id));
    const edited = structuredClone(graph);
    edited.clues.clue_welly_prints.text = "EDITED ON DISK";
    edited.locations.greenhouse.name = "EDITED PLACE";
    fs.writeFileSync(file, JSON.stringify(edited));

    const found = await play(opened.game_id, "search the smashed pumpkin");
    expect(found.revealed_clues.map((clue) => [clue.id, clue.text])).toEqual([
      ["clue_welly_prints", graph.clues.clue_welly_prints.text],
    ]);
    const response = await getGame(new Request(`http://test/api/game-get?game_id=${opened.game_id}`), ctx);
    const resumed = GameGetResponseSchema.parse(await response.json());
    expect(resumed.state.locations.find((place) => place.id === "greenhouse")?.name).toBe("The Greenhouse");
    expect(resumed.state.discovered_clues?.map((clue) => clue.text)).toEqual([graph.clues.clue_welly_prints.text]);
    const catalog = await (await listSessions(new Request("http://test/api/game-sessions-list"), ctx)).json();
    expect(catalog.in_progress[0]).toMatchObject({ mystery_title: "The Smashed Prize Pumpkin — clue graph" });
  });

  it("refuses a snapshot that does not match its session", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    const other = greenhouse();
    other.metadata.id = "another-case";
    local.db.prepare("update game_sessions set clue_graph_snapshot = ? where id = ?").run(JSON.stringify(other), opened.game_id);
    await expect(ctx.sessions.getById(opened.game_id)).rejects.toThrow("does not match");
  });

  it("gives first words with the greeting, records an opened gate's clue that turn and applies its retraction", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "search");
    await play(opened.game_id, "go to the garden");
    const greeting = await play(opened.game_id, "talk to Mr. Thorne");
    expect(greeting.revealed_clues.map((clue) => clue.id)).toEqual([
      "thorne_alibi",
      "clue_thorne_mia_cake",
      "thorne_never_set_foot",
    ]);
    expect(greeting.events[0].narration_parts[0].text).toContain("never set foot");

    const before = await derived(opened.game_id);
    expect(deriveClueGraph(before.graph, before.events).leads.map((lead) => lead.key)).toContain("talk:thorne");

    const line = await play(opened.game_id, "These are your boot prints: clue_boot_prints");
    expect(line.revealed_clues.map((clue) => clue.id)).toEqual(["clue_thorne_measured"]);
    const after = await derived(opened.game_id);
    const state = deriveClueGraph(after.graph, after.events);
    expect(state.play.retracted).toEqual(["thorne_never_set_foot"]);
    expect(state.notebook.find((entry) => entry.id === "thorne_never_set_foot")?.taken_back).toBe(true);
    expect(state.leads.map((lead) => lead.key)).not.toContain("talk:thorne");
    expect((await ctx.sessions.getById(opened.game_id))?.discovered_clues).toContain("clue_thorne_measured");
  });

  it("records an answer and a subject tell the state offered, keeping pure tells out of the notebook", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    const asked = await play(opened.game_id, "What about the missing key?");
    // The next first word, then the answer; the tell riding on it is a pure tell, so only the play holds it.
    expect(asked.revealed_clues.map((clue) => clue.id)).toEqual(["clue_toby_thorne_ladder", "toby_no_key"]);
    const { graph, events } = await derived(opened.game_id);
    expect(deriveClueGraph(graph, events).play.held).toContain("react_toby_pocket");
  });

  it("records a subject tell when the line brings its subject up, and a pointer tell in the notebook", async () => {
    installed(fixture());
    const opened = await start(clueGraphCaseId("greenhouse-fixture"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    await play(opened.game_id, "Nice wellies");
    const asked = await play(opened.game_id, "What about the missing key?");
    // In the fixture the pocket tell points at the water butt, so the notebook keeps it.
    expect(asked.revealed_clues.map((clue) => clue.id)).toEqual(["toby_no_key", "react_toby_pocket"]);
    const { graph, events } = await derived(opened.game_id);
    expect(events.at(-2)).toEqual({ type: "line", character: "toby", opened: [], asked: [], seen: ["react_toby_wellies"] });
    expect(deriveClueGraph(graph, events).play.held).toContain("react_toby_wellies");
    // Another character's tell was never offered.
    await expect(play(opened.game_id, "Hm", reporting([], ["react_mia_pen"]))).rejects.toBeInstanceOf(RetriableAIError);
  });

  it.each([
    ["a physical gate without its clue", "thorne_ladder_thursday", "go to the garden", "talk to Mr. Thorne"],
    ["a gate whose after is not out", "toby_confession", "go to the potting shed", "talk to Toby"],
  ])("fails a talk reveal of %s before narration or events are saved", async (_name, gate, move, talk) => {
    installed(fixture());
    const opened = await start(clueGraphCaseId("greenhouse-fixture"));
    await play(opened.game_id, move);
    await play(opened.game_id, talk);
    const events = await ctx.events.listBySession(opened.game_id);
    const session = await ctx.sessions.getById(opened.game_id);
    await expect(play(opened.game_id, "Tell me everything", reporting([gate]))).rejects.toBeInstanceOf(RetriableAIError);
    expect(await ctx.events.listBySession(opened.game_id)).toEqual(events);
    expect(await ctx.sessions.getById(opened.game_id)).toEqual(session);
    // An answer the state did not offer fails the same way.
    await expect(play(opened.game_id, "Tell me", reporting([], ["clue_hale_borrowed_pen"]))).rejects.toBeInstanceOf(RetriableAIError);
    expect(await ctx.events.listBySession(opened.game_id)).toEqual(events);
  });

  it("opens a bluffable gate on a bluff, but never a physical one", async () => {
    installed(fixture());
    const opened = await start(clueGraphCaseId("greenhouse-fixture"));
    await play(opened.game_id, "go to the garden");
    await play(opened.game_id, "talk to Mr. Thorne");
    // clue_thorne_measured is bluffable: the boot prints are not held.
    const bluff = await play(opened.game_id, "I saw clue_boot_prints, you know");
    expect(bluff.revealed_clues.map((clue) => clue.id)).toEqual(["clue_thorne_measured"]);
    // thorne_ladder_thursday is physical: naming the tape mark without it opens nothing.
    const named = await play(opened.game_id, "What about clue_ladder_tape?");
    expect(named.revealed_clues).toEqual([]);
  });

  it("files an offered id by what it is, whichever list the narrator put it in", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "search");
    await play(opened.game_id, "go to the garden");
    await play(opened.game_id, "talk to Mr. Thorne");
    const line = await play(opened.game_id, "Look at these prints", reporting([], ["clue_thorne_measured"]));
    expect(line.revealed_clues.map((clue) => clue.id)).toEqual(["clue_thorne_measured"]);
    const { events } = await derived(opened.game_id);
    expect(events.at(-1)).toEqual({ type: "line", character: "thorne", opened: ["clue_thorne_measured"], asked: [], seen: [] });
  });

  it("tells a farewell narrator only the clues already found", async () => {
    const graph = greenhouse();
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    let farewell = "";
    const keeping = (profile: Profile): AIProvider => {
      const inner = createAIProviderFromProfile(profile);
      return {
        profile: inner.profile,
        resolvedModel: inner.resolvedModel,
        generateNarration: inner.generateNarration.bind(inner),
        generateRoleOutput: async (request) => {
          if (request.role === "talk_end") farewell = JSON.stringify(request.context);
          return inner.generateRoleOutput(request);
        },
      };
    };
    await play(opened.game_id, "bye", keeping);
    expect(farewell).toContain(graph.clues.toby_alibi.text);
    expect(farewell).not.toContain(graph.clues.toby_confession.text);
    expect(farewell).not.toContain(graph.clues.toby_no_key.text);
  });

  it("drops reports of clues already held instead of failing", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "go to the garden");
    await play(opened.game_id, "talk to Mr. Thorne");
    const line = await play(opened.game_id, "Hello again", reporting(["thorne_alibi"]));
    expect(line.revealed_clues).toEqual([]);
  });

  it("lets a revisit greeting restate what is held, but fails one that reports a gate", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "go to the garden");
    await play(opened.game_id, "talk to Mr. Thorne");
    await play(opened.game_id, "bye");
    const again = await play(opened.game_id, "talk to Mr. Thorne", reporting([], ["thorne_alibi"]));
    expect(again.revealed_clues).toEqual([]);
    await play(opened.game_id, "bye");
    const events = await ctx.events.listBySession(opened.game_id);
    await expect(play(opened.game_id, "talk to Mr. Thorne", reporting(["clue_thorne_measured"]))).rejects.toBeInstanceOf(
      RetriableAIError,
    );
    expect(await ctx.events.listBySession(opened.game_id)).toEqual(events);
  });

  it("does not record a line it did not understand", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    const mashed = await play(opened.game_id, "xzqv");
    expect(mashed.revealed_clues).toEqual([]);
    const { events } = await derived(opened.game_id);
    expect(events.map((event) => event.type)).toEqual(["move", "talk"]);
  });

  it("gives one clue a search, hides a hidden spot until its pointer is held, then finds it", async () => {
    const graph = fixture();
    installed(graph);
    const opened = await start(clueGraphCaseId(graph.metadata.id));
    const plain = await play(opened.game_id, "search");
    expect(plain.revealed_clues.map((clue) => clue.id)).toEqual(["clue_boot_prints"]);
    const again = await play(opened.game_id, "search");
    expect(again.revealed_clues).toEqual([]);

    const early = await play(opened.game_id, "search the water butt");
    expect(early.revealed_clues).toEqual([]);
    expect(early.state.time_remaining).toBe(graph.metadata.time_budget - 3);

    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    const pointer = await play(opened.game_id, "What about the missing key?");
    expect(pointer.revealed_clues.map((clue) => clue.id)).toContain("react_toby_pocket");
    await play(opened.game_id, "bye");
    await play(opened.game_id, "go to the greenhouse");
    const found = await play(opened.game_id, "search the water butt");
    expect(found.revealed_clues.map((clue) => clue.id)).toEqual(["clue_key_in_water_butt"]);
  });

  it("fails a search that reports another clue than its spot holds", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    const events = await ctx.events.listBySession(opened.game_id);
    const wrong = answering(() => ({ narration: "Found!", revealed_clue_id: "clue_glass_outside", costs_turn: true, input_understood: true }));
    await expect(play(opened.game_id, "search the smashed pumpkin", wrong)).rejects.toBeInstanceOf(RetriableAIError);
    await expect(play(opened.game_id, "search", wrong)).rejects.toBeInstanceOf(RetriableAIError);
    expect(await ctx.events.listBySession(opened.game_id)).toEqual(events);
  });

  it("lets the narrator match loose search words to a visible spot, and nothing else", async () => {
    const graph = fixture();
    installed(graph);
    const opened = await start(clueGraphCaseId(graph.metadata.id));
    const choosing = (id: string) =>
      answering(() => ({ narration: "Found!", revealed_clue_id: id, costs_turn: true, input_understood: true }));
    // "the busted glass" names no spot; the window is visible, the water butt hidden.
    await expect(play(opened.game_id, "search the busted glass", choosing("clue_key_in_water_butt"))).rejects.toBeInstanceOf(
      RetriableAIError,
    );
    const found = await play(opened.game_id, "search the busted glass", choosing("clue_glass_outside"));
    expect(found.revealed_clues.map((clue) => clue.id)).toEqual(["clue_glass_outside"]);
  });

  it("sends the judge the graph and the derived progress, and wins only with the culprit supported", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    let judged: Record<string, unknown> | null = null;
    const spy = (profile: Profile): AIProvider => {
      const inner = createAIProviderFromProfile(profile);
      return {
        profile: inner.profile,
        resolvedModel: inner.resolvedModel,
        generateNarration: inner.generateNarration.bind(inner),
        generateRoleOutput: async (request) => {
          if (request.role === "accusation_judge") judged = request.context;
          return inner.generateRoleOutput(request);
        },
      };
    };
    await play(opened.game_id, "accuse");
    expect((await play(opened.game_id, "It was Toby", spy)).result).toBeNull();
    const judge = (judged as unknown as { accusation_judge_context: Record<string, unknown> }).accusation_judge_context;
    expect((judge.full_blueprint as { clue_graph?: unknown }).clue_graph).toEqual(greenhouse());
    expect(judge.clue_graph_progress).toEqual({ supported_conclusions: [], culprit_supported: false, taken_back: [] });
  });

  it("never sends truth, rules, gate wording or the culprit to the browser", async () => {
    const graph = greenhouse();
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    const answers = [JSON.stringify(opened)];
    for (const line of ["search the smashed pumpkin", "go to the potting shed", "talk to Toby", "What about the missing key?"])
      answers.push(JSON.stringify(await play(opened.game_id, line)));
    answers.push(JSON.stringify(await (await getGame(new Request(`http://test/api/game-get?game_id=${opened.game_id}`), ctx)).json()));
    const seen = answers.join("\n");
    const secrets = [
      ...graph.truth.timeline,
      ...Object.values(graph.conclusions).map((conclusion) => conclusion.text),
      ...Object.values(graph.clues).flatMap((clue) => {
        if (clue.kind !== "statement") return [];
        const gate = clue.reached.by === "gated" ? clue.reached.gate : undefined;
        return [clue.why, gate?.line?.text].filter((text): text is string => Boolean(text));
      }),
      '"truth"',
      '"rule"',
      "is_culprit",
      '"culprit"',
      "clue_graph_snapshot",
      "toby_confession",
    ];
    for (const secret of secrets) expect(seen, secret).not.toContain(secret);
  });
});
