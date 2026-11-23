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
import {
  createAIProviderFromProfile,
  mockNotebookLine,
  type AIProvider,
  type AIRoleOutputRequest,
} from "../../../packages/game-engine/src/ai-provider.ts";
import type { GraphTalkContext } from "../../../packages/game-engine/src/clue-graph/narrator-context.ts";
import { handle as startGame } from "../../../packages/game-engine/src/endpoints/game-start.ts";
import { handle as getGame } from "../../../packages/game-engine/src/endpoints/game-get.ts";
import { handle as listSessions } from "../../../packages/game-engine/src/endpoints/game-sessions-list.ts";
import { playTurn } from "../../../packages/game-engine/src/turn/play-turn.ts";
import { RetriableAIError } from "../../../packages/game-engine/src/errors.ts";
import { clueGraphEvents } from "../../../packages/game-engine/src/clue-graph/history.ts";
import { replay } from "../../../packages/game-engine/src/clue-graph/play.ts";
import { notebookMarks } from "../../../packages/game-engine/src/clue-graph/notebook-view.ts";
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
  delete graph.clues.react_toby_pocket.colour;
  const ladder = graph.clues.thorne_ladder_thursday;
  if (ladder.kind !== "statement" || ladder.reached.by !== "gated") throw new Error("The ladder clue is gated");
  ladder.reached.gate.physical = true;
  graph.clues.react_toby_wellies = {
    kind: "tell",
    fact: "Toby tucks his feet under the bench.",
    source: { character: "toby" },
    reached: { by: "seen", subject: "wellies" },
    colour: true,
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

/** A test narrator's notebook line: plainly not the fact, so a test can see which one a reader shows. */
const noted = (id: string) => `Noted: ${id}`;

/**
 * The notebook a narrator owes for a talk line: every first word due, and each
 * reported id the state offers, with the tells that ride on them.
 */
function owedNotebook(request: AIRoleOutputRequest<unknown>, reported: string[]) {
  const { state } = request.context.graph_talk_context as GraphTalkContext;
  const offered = [...state.answers_if_asked, ...state.gates].filter((entry) => reported.includes(entry.id));
  const tells = state.shows_when.filter((entry) => reported.includes(entry.id)).map((entry) => entry.id);
  const ids = [...state.says_first, ...offered].flatMap((entry) => [entry.id, ...entry.with.map((rider) => rider.id)]);
  return [...ids, ...tells].map((id) => ({ id, line: noted(id) }));
}

function reporting(opened: string[], answered: string[] = []) {
  return answering((request) => ({
    narration: "A line.",
    opened,
    answered,
    notebook: owedNotebook(request, [...opened, ...answered]),
    input_understood: true,
  }));
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

  it("lists the greenhouse and pins it to the session", async () => {
    const entries = await ctx.content.listBlueprints(silent);
    const index = entries.findIndex((entry) => entry.blueprint.id === clueGraphCaseId("greenhouse-prizewinner"));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(entries[index].blueprint.metadata.title).toBe("The Smashed Prize Pumpkin — clue graph");

    const started = await start(clueGraphCaseId("greenhouse-prizewinner"));
    expect(started.narration_events[0].payload).toMatchObject({ case_format: "clue-graph/2" });
    expect((await ctx.sessions.getById(started.game_id))?.clue_graph_snapshot).toEqual(greenhouse());
  });

  it("resumes and plays from the snapshot after the file on disk is edited", async () => {
    const graph = fixture();
    const file = installed(graph);
    const opened = await start(clueGraphCaseId(graph.metadata.id));
    const edited = structuredClone(graph);
    edited.clues.clue_welly_prints.fact = "EDITED ON DISK";
    edited.locations.greenhouse.name = "EDITED PLACE";
    fs.writeFileSync(file, JSON.stringify(edited));

    const found = await play(opened.game_id, "search the smashed pumpkin");
    const line = mockNotebookLine(graph.clues.clue_welly_prints.fact);
    expect(found.revealed_clues.map((clue) => [clue.id, clue.text])).toEqual([["clue_welly_prints", line]]);
    const response = await getGame(new Request(`http://test/api/game-get?game_id=${opened.game_id}`), ctx);
    const resumed = GameGetResponseSchema.parse(await response.json());
    expect(resumed.state.locations.find((place) => place.id === "greenhouse")?.name).toBe("The Greenhouse");
    expect(resumed.state.discovered_clues?.map((clue) => clue.text)).toEqual([line]);
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
      "react_thorne_boot",
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

  it("marks a lead new on its turn only and a statement taken back, live and on resume", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    const keys = (leads: Array<{ key: string }> | undefined) => (leads ?? []).map((lead) => lead.key);
    // Before anything is played every lead is new, and the case file's wording stays out of them.
    expect(keys(opened.state.leads)).toContain("meet:thorne");
    expect(opened.state.leads?.every((lead) => lead.new)).toBe(true);

    const searched = await play(opened.game_id, "search");
    expect(searched.leads?.every((lead) => !lead.new)).toBe(true);
    const moved = await play(opened.game_id, "go to the garden");
    expect(moved.leads?.find((lead) => lead.key === "meet:thorne")?.new).toBe(false);
    const greeting = await play(opened.game_id, "talk to Mr. Thorne");
    expect(greeting.leads).toContainEqual({ key: "talk:thorne", text: "Mr. Thorne may know more.", new: true });
    expect(greeting.leads?.find((lead) => lead.key === "meet:thorne")).toBeUndefined();
    expect(greeting.taken_back).toEqual([]);
    expect(greeting.revealed_clues.map((clue) => [clue.id, clue.kind, clue.taken_back])).toContainEqual([
      "thorne_never_set_foot",
      "statement",
      false,
    ]);

    // The retraction turn: the statement is marked, and the lead that was new is not new any more.
    const line = await play(opened.game_id, "These are your boot prints: clue_boot_prints");
    expect(line.taken_back).toEqual(["thorne_never_set_foot"]);
    expect(keys(line.leads)).not.toContain("talk:thorne");
    expect(line.leads?.some((lead) => lead.new)).toBe(false);

    const resumed = GameGetResponseSchema.parse(
      await (await getGame(new Request(`http://test/api/game-get?game_id=${opened.game_id}`), ctx)).json(),
    );
    expect(resumed.state.leads).toEqual(line.leads);
    const notebook = resumed.state.discovered_clues ?? [];
    expect(notebook.find((clue) => clue.id === "thorne_never_set_foot")).toMatchObject({ kind: "statement", taken_back: true });
    expect(notebook.find((clue) => clue.id === "clue_thorne_measured")).toMatchObject({ taken_back: false });

    // A turn that plays no graph event leaves nothing new.
    const accusing = await play(opened.game_id, "accuse");
    expect(accusing.leads?.some((lead) => lead.new)).toBe(false);
  });

  it("never names a statement the player has not heard as taken back", async () => {
    // Thorne takes back something Toby said, which the player has not heard: the case file would not
    // pass the validator, but the play still folds it, and the notebook must not name it.
    const graph = greenhouse();
    const measured = graph.clues.clue_thorne_measured;
    if (measured.kind !== "statement") throw new Error("The measuring clue is a statement");
    measured.takes_back = ["toby_alibi"];
    const history = [
      { payload: { clue_graph: { type: "move", location: "thorne_garden" } } },
      { payload: { clue_graph: { type: "talk", character: "thorne" } } },
      { payload: { clue_graph: { type: "line", character: "thorne", opened: ["clue_thorne_measured"], asked: [], seen: [] } } },
    ];
    const play = replay(graph, clueGraphEvents(history));
    expect(play.held).toContain("clue_thorne_measured");
    expect(play.retracted).toContain("toby_alibi");
    const marks = notebookMarks(graph, history);
    expect(marks.taken_back).toEqual([]);
  });

  it("marks a hidden spot's lead new the turn its pointer is found", async () => {
    installed(fixture());
    const opened = await start(clueGraphCaseId("greenhouse-fixture"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    const asked = await play(opened.game_id, "What about the missing key?");
    expect(asked.leads).toContainEqual({
      key: expect.stringMatching(/^spot:/),
      text: "Something new to search at The Greenhouse: the water butt by the door.",
      new: true,
    });
    const seen = JSON.stringify(asked);
    expect(seen).not.toMatch(/"truth"|"rule"|toby_confession/);
  });

  it("records an answer and the tell riding on it, each with its notebook line", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    const asked = await play(opened.game_id, "What about the missing key?");
    // The answer, and the tell that rides on it: every tell is recorded.
    expect(asked.revealed_clues.map((clue) => clue.id)).toEqual(["toby_no_key", "react_toby_pocket"]);
    const { graph, events } = await derived(opened.game_id);
    const line = events.at(-1);
    expect(line?.type === "line" && line.notebook).toEqual({
      toby_no_key: mockNotebookLine(graph.clues.toby_no_key.fact),
      react_toby_pocket: mockNotebookLine(graph.clues.react_toby_pocket.fact),
    });
    expect(asked.revealed_clues.find((clue) => clue.id === "react_toby_pocket")).toMatchObject({
      kind: "tell",
      text: mockNotebookLine(graph.clues.react_toby_pocket.fact),
    });
  });

  it("keeps a turn whose narrator also reported the tell riding on its answer", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    // The tell comes out with the answer anyway, so reporting it is harmless.
    const asked = await play(opened.game_id, "What about the missing key?", reporting([], ["toby_no_key", "react_toby_pocket"]));
    expect(asked.revealed_clues.map((clue) => clue.id)).toEqual(["toby_no_key", "react_toby_pocket"]);
    const { events } = await derived(opened.game_id);
    expect(events.at(-1)).toMatchObject({ type: "line", asked: ["toby_no_key"], seen: [] });
  });

  it("records a subject tell when the line brings its subject up, and a pointer tell in the notebook", async () => {
    installed(fixture());
    const opened = await start(clueGraphCaseId("greenhouse-fixture"));
    await play(opened.game_id, "go to the potting shed");
    await play(opened.game_id, "talk to Toby");
    await play(opened.game_id, "Nice wellies");
    const asked = await play(opened.game_id, "What about the missing key?");
    expect(asked.revealed_clues.map((clue) => clue.id)).toEqual(["toby_no_key", "react_toby_pocket"]);
    const { graph, events } = await derived(opened.game_id);
    expect(events.at(-2)).toEqual({
      type: "line",
      character: "toby",
      opened: [],
      asked: [],
      seen: ["react_toby_wellies"],
      notebook: { react_toby_wellies: mockNotebookLine(graph.clues.react_toby_wellies.fact) },
    });
    // The pocket tell points at the hidden water butt: its words and its line name the spot.
    const pointer = mockNotebookLine(graph.clues.react_toby_pocket.fact, { spot: "the water butt by the door", location: "The Greenhouse" });
    expect(pointer).toContain("the water butt by the door");
    expect(asked.revealed_clues.find((clue) => clue.id === "react_toby_pocket")?.text).toBe(pointer);
    expect(asked.events[0].narration_parts[0].text).toContain("the water butt by the door");
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
    expect(events.at(-1)).toEqual({
      type: "line",
      character: "thorne",
      opened: ["clue_thorne_measured"],
      asked: [],
      seen: [],
      notebook: { clue_thorne_measured: noted("clue_thorne_measured") },
    });
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
    expect(farewell).toContain(graph.clues.toby_alibi.fact);
    expect(farewell).not.toContain(graph.clues.toby_confession.fact);
    expect(farewell).not.toContain(graph.clues.toby_no_key.fact);
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
      answering(() => ({ narration: "Found!", revealed_clue_id: id, costs_turn: true, input_understood: true, notebook: [{ id, line: noted(id) }] }));
    // "the busted glass" names no spot; the window is visible, the water butt hidden.
    await expect(play(opened.game_id, "search the busted glass", choosing("clue_key_in_water_butt"))).rejects.toBeInstanceOf(
      RetriableAIError,
    );
    const found = await play(opened.game_id, "search the busted glass", choosing("clue_glass_outside"));
    expect(found.revealed_clues.map((clue) => clue.id)).toEqual(["clue_glass_outside"]);
  });

  it("asks the judge only who was named and what was cited, failing on someone the case does not hold", async () => {
    const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
    await play(opened.game_id, "accuse");
    const events = await ctx.events.listBySession(opened.game_id);
    const nobody = answering(() => ({ accused_character_id: "nobody_here", cited_clue_ids: [] }));
    await expect(play(opened.game_id, "It was Toby", nobody)).rejects.toBeInstanceOf(RetriableAIError);
    expect(await ctx.events.listBySession(opened.game_id)).toEqual(events);

    const roles: string[] = [];
    const watching = (profile: Profile): AIProvider => {
      const inner = createAIProviderFromProfile(profile);
      return { ...inner, profile: inner.profile, resolvedModel: inner.resolvedModel, generateNarration: inner.generateNarration.bind(inner), generateRoleOutput: async (request) => {
        roles.push(request.role);
        return inner.generateRoleOutput(request);
      } };
    };
    // A clue the player does not hold, reported as cited, is dropped.
    const citingUnheld = (profile: Profile): AIProvider => {
      const inner = watching(profile);
      return {
        ...inner,
        generateRoleOutput: async (request) =>
          request.role === "graph_accusation"
            ? request.parse({ accused_character_id: "toby", cited_clue_ids: ["clue_welly_prints"] })
            : inner.generateRoleOutput(request),
      };
    };
    const asked = await play(opened.game_id, "It was Toby: the welly prints", citingUnheld);
    expect(roles).toEqual(["graph_accusation_round"]);
    expect(asked.result).toBeNull();
    expect((await ctx.events.listBySession(opened.game_id)).at(-1)?.payload).toMatchObject({
      role: "graph_accusation_round",
      player_reasoning: "It was Toby: the welly prints",
      judge_result: "continue",
      clue_graph_accusation: { accused: "toby", cited: [], verdict: "not_yet" },
      reply_kind: "missing",
    });
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

  /**
   * The mock narrator with every notebook line replaced by `noted`, and each
   * structured request's context kept by role, so a test can see what a later
   * turn is handed.
   */
  function notingAll(seen: Map<string, Record<string, unknown>>) {
    return (profile: Profile): AIProvider => {
      const inner = createAIProviderFromProfile(profile);
      return {
        profile: inner.profile,
        resolvedModel: inner.resolvedModel,
        generateNarration: inner.generateNarration.bind(inner),
        generateRoleOutput: async (request) => {
          seen.set(request.role, request.context);
          const parse = request.parse;
          return inner.generateRoleOutput({
            ...request,
            parse: (payload) => {
              const output = payload as { notebook?: Array<{ id: string; line: string }> };
              const notebook = output.notebook?.map(({ id }) => ({ id, line: noted(id) }));
              return parse(notebook ? { ...output, notebook } : output);
            },
          });
        },
      };
    };
  }

  describe("notebook lines", () => {
    it.each([
      ["leaves out a line for a clue it reveals", (lines: Array<{ id: string; line: string }>) => lines.slice(1)],
      ["gives a line for a clue it does not reveal", (lines: Array<{ id: string; line: string }>) => [...lines, { id: "toby_confession", line: "No." }]],
      ["gives an empty line", (lines: Array<{ id: string; line: string }>) => [{ ...lines[0], line: "  " }, ...lines.slice(1)]],
      ["gives one clue two lines", (lines: Array<{ id: string; line: string }>) => [...lines, lines[0]]],
    ])("fails a turn whose reply %s, before anything is saved", async (_name, change) => {
      const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
      await play(opened.game_id, "go to the potting shed");
      const events = await ctx.events.listBySession(opened.game_id);
      const session = await ctx.sessions.getById(opened.game_id);
      const greeting = answering((request) => ({
        narration: "Toby looks up.",
        opened: [],
        answered: [],
        notebook: change(owedNotebook(request, [])),
        input_understood: true,
      }));
      await expect(play(opened.game_id, "talk to Toby", greeting)).rejects.toBeInstanceOf(RetriableAIError);
      expect(await ctx.events.listBySession(opened.game_id)).toEqual(events);
      expect(await ctx.sessions.getById(opened.game_id)).toEqual(session);
    });

    it("keeps a greeting's first words and lines even when the narrator calls it not understood", async () => {
      const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
      await play(opened.game_id, "go to the potting shed");
      const confused = answering((request) => ({
        narration: "Toby looks up.",
        opened: [],
        answered: [],
        notebook: owedNotebook(request, []),
        input_understood: false,
      }));
      const greeting = await play(opened.game_id, "talk to Toby", confused);
      expect(greeting.revealed_clues.map((clue) => [clue.id, clue.text])).toEqual(
        ["toby_alibi", "react_toby_sweeping", "react_toby_trainers", "toby_blames_thorne", "clue_toby_thorne_ladder"].map((id) => [
          id,
          noted(id),
        ]),
      );
    });

    it("fails a search that finds a clue but writes no line for it", async () => {
      const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
      const events = await ctx.events.listBySession(opened.game_id);
      const unwritten = answering(() => ({ narration: "Found!", revealed_clue_id: "clue_welly_prints", costs_turn: true, input_understood: true, notebook: [] }));
      await expect(play(opened.game_id, "search the smashed pumpkin", unwritten)).rejects.toBeInstanceOf(RetriableAIError);
      expect(await ctx.events.listBySession(opened.game_id)).toEqual(events);
    });

    it("drops a line for a clue already held that the narrator restated", async () => {
      const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
      await play(opened.game_id, "go to the garden");
      await play(opened.game_id, "talk to Mr. Thorne");
      const restating = answering(() => ({
        narration: "Again.",
        opened: [],
        answered: ["thorne_alibi"],
        notebook: [{ id: "thorne_alibi", line: "A second wording." }],
        input_understood: true,
      }));
      expect((await play(opened.game_id, "Where were you?", restating)).revealed_clues).toEqual([]);
      const { graph, events } = await derived(opened.game_id);
      expect(deriveClueGraph(graph, events).notebook.find((entry) => entry.id === "thorne_alibi")?.text).toBe(
        mockNotebookLine(graph.clues.thorne_alibi.fact),
      );
    });

    it("is what the notebook, later turns and the accusation read for a clue, a tell's included", async () => {
      const seen = new Map<string, Record<string, unknown>>();
      const noting = notingAll(seen);
      const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
      await play(opened.game_id, "search", noting);
      await play(opened.game_id, "go to the garden", noting);
      const greeting = await play(opened.game_id, "talk to Mr. Thorne", noting);
      expect(greeting.revealed_clues.map((clue) => [clue.id, clue.text])).toContainEqual(["react_thorne_boot", noted("react_thorne_boot")]);
      const { events } = await derived(opened.game_id);
      expect(events.at(-1)).toMatchObject({ type: "talk", notebook: { react_thorne_boot: noted("react_thorne_boot"), thorne_alibi: noted("thorne_alibi") } });

      // A later line is handed the saved lines: what was said, what was seen, and a held clue to show.
      await play(opened.game_id, "Hello", noting);
      const { state } = (seen.get("graph_talk") as { graph_talk_context: GraphTalkContext }).graph_talk_context;
      expect(state.story_so_far.map((entry) => entry.says)).toEqual(["thorne_alibi", "clue_thorne_mia_cake", "thorne_never_set_foot"].map(noted));
      expect(state.established).toEqual([noted("react_thorne_boot")]);
      const shown = state.gates.flatMap((gate) => gate.opens_with.show?.clues ?? []).find((clue) => clue.id === "clue_boot_prints");
      expect(shown).toMatchObject({ held: true, text: noted("clue_boot_prints") });

      const resumed = GameGetResponseSchema.parse(await (await getGame(new Request(`http://test/api/game-get?game_id=${opened.game_id}`), ctx)).json());
      expect(resumed.state.discovered_clues?.map((clue) => clue.text)).toEqual(resumed.state.discovered_clues?.map((clue) => noted(clue.id)));

      await play(opened.game_id, "bye", noting);
      await play(opened.game_id, "accuse", noting);
      await play(opened.game_id, "It was Toby: clue_boot_prints", noting);
      for (const role of ["graph_accusation", "graph_accusation_round"]) {
        const { held } = (seen.get(role) as { graph_accusation_context: { held: Array<{ id: string; text: string }> } }).graph_accusation_context;
        expect(held.length, role).toBeGreaterThan(0);
        if (role === "graph_accusation_round") expect(held.map((entry) => entry.id)).toEqual(["clue_boot_prints"]);
        for (const clue of held) expect(clue.text).toBe(noted(clue.id));
      }
    });

    it("tells a farewell narrator the saved lines", async () => {
      const seen = new Map<string, Record<string, unknown>>();
      const opened = await start(clueGraphCaseId("greenhouse-prizewinner"));
      await play(opened.game_id, "go to the potting shed", notingAll(seen));
      await play(opened.game_id, "talk to Toby", notingAll(seen));
      await play(opened.game_id, "bye", notingAll(seen));
      const farewell = seen.get("talk_end") as { talk_context: { active_character: { clues: Array<{ id: string; text: string }> } } };
      const clues = farewell.talk_context.active_character.clues;
      expect(clues.map((clue) => clue.id)).toContain("toby_alibi");
      for (const clue of clues) expect(clue.text).toBe(noted(clue.id));
    });
  });
});
