import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClueGraphCase } from "../../../packages/shared/src/clue-graph-schema.ts";
import { validateClueGraph } from "../../../packages/shared/src/clue-graph-validator.ts";
import {
  applyEvent,
  availableGates,
  replay,
  visibleSpots,
  type ClueGraphEvent,
} from "../../../packages/game-engine/src/clue-graph/play.ts";
import { talkState } from "../../../packages/game-engine/src/clue-graph/talk-state.ts";
import {
  currentLeads,
  deriveClueGraph,
  notebook,
} from "../../../packages/game-engine/src/clue-graph/leads.ts";

const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";
const committed = validateClueGraph(JSON.parse(fs.readFileSync(GREENHOUSE, "utf8")));

function greenhouse(): ClueGraphCase {
  return structuredClone(committed);
}

const line = (character: string, report: Omit<Extract<ClueGraphEvent, { type: "line" }>, "type" | "character">) =>
  ({ type: "line", character, ...report }) as const;

const SHED: ClueGraphEvent = { type: "move", location: "potting_shed" };
const GARDEN: ClueGraphEvent = { type: "move", location: "thorne_garden" };
/** With the toppled bench hidden behind Ms. Hale's last crack: it is found once she gives it. */
const HALE_EVENTS: ClueGraphEvent[] = [
  SHED,
  { type: "search", spot: "the watering rota on the door" },
  { type: "move", location: "greenhouse" },
  { type: "search", spot: "the toppled bench" },
  { type: "talk", character: "hale" },
  line("hale", { opened: ["clue_hale_borrowed_pen", "hale_toby_fine"] }),
  line("hale", { opened: ["clue_hale_toby_upset"] }),
  { type: "search", spot: "the toppled bench" },
];

/**
 * The prototype's `scripted_play()` (evaluation/prototypes/clue-graph/graph.py),
 * with each `use` and `ask` as the line the narrator reports. First words come
 * out three a line here, not all at once, so Toby's ladder story follows his
 * greeting by one line.
 */
interface Step {
  event: ClueGraphEvent;
  turns: number;
  revealed: string[];
  notebook: string[];
  /** Leads by key; a `*` marks one new this turn. */
  leads: string[];
  retracted: string[];
  conclusions: string[];
  /** The talk state of the character just spoken to, summarised. */
  talk?: TalkSummary;
}

interface TalkSummary {
  stance: string;
  says_first: string[];
  asks: string[];
  gates: string[];
  story: string[];
  established: number;
  keeps_back: number;
}

const ALL_MEET = ["meet:hale", "meet:toby", "meet:mia", "meet:dobbs", "meet:thorne"];
const SEARCHED = ["clue_glass_outside", "clue_welly_prints", "clue_boot_prints"];
const TOBY_GREETING = ["toby_alibi", "toby_blames_thorne"];
const TOBY_LINES = [...TOBY_GREETING, "clue_toby_thorne_ladder", "toby_drops_burglar", "toby_blames_mia"];
const THORNE = ["thorne_alibi", "clue_thorne_mia_cake", "thorne_never_set_foot"];
const BEFORE_DOBBS = [...SEARCHED, ...TOBY_LINES, "mia_alibi", ...THORNE, "clue_thorne_measured"];
const AFTER_DOBBS = [...BEFORE_DOBBS, "dobbs_rounds", "react_dobbs_slippers", "clue_dobbs_crash_time"];
const SOLVED = ["nobody_broke_in", "prints_explained", "mia_cleared", "culprit_toby"];

const SCRIPT: Step[] = [
  {
    event: { type: "search", spot: "the broken side window" },
    turns: 1,
    revealed: ["clue_glass_outside"],
    notebook: ["clue_glass_outside"],
    leads: ALL_MEET,
    retracted: [],
    conclusions: ["nobody_broke_in"],
  },
  {
    event: { type: "search", spot: "the smashed pumpkin" },
    turns: 2,
    revealed: ["clue_welly_prints"],
    notebook: SEARCHED.slice(0, 2),
    leads: ALL_MEET,
    retracted: [],
    conclusions: ["nobody_broke_in"],
  },
  {
    event: { type: "search" },
    turns: 3,
    revealed: ["clue_boot_prints"],
    notebook: SEARCHED,
    leads: ALL_MEET,
    retracted: [],
    conclusions: ["nobody_broke_in"],
  },
  {
    event: { type: "move", location: "potting_shed" },
    turns: 4,
    revealed: [],
    notebook: SEARCHED,
    leads: ALL_MEET,
    retracted: [],
    conclusions: ["nobody_broke_in"],
  },
  {
    event: { type: "talk", character: "toby" },
    turns: 5,
    revealed: ["toby_alibi", "react_toby_sweeping", "react_toby_trainers", "toby_blames_thorne"],
    notebook: [...SEARCHED, ...TOBY_GREETING],
    leads: ["meet:hale", "*talk:toby", "meet:mia", "meet:dobbs", "meet:thorne"],
    retracted: [],
    conclusions: ["nobody_broke_in"],
    talk: {
      stance: "guarded",
      says_first: ["clue_toby_thorne_ladder"],
      asks: ["toby_no_key"],
      gates: ["clue_toby_mia_splat~", "toby_drops_burglar~", "toby_blames_mia~"],
      story: ["toby_alibi", "toby_blames_thorne"],
      established: 2,
      keeps_back: 1,
    },
  },
  {
    event: line("toby", { opened: ["toby_drops_burglar"] }),
    turns: 5,
    revealed: ["clue_toby_thorne_ladder", "toby_drops_burglar"],
    notebook: [...SEARCHED, ...TOBY_LINES.slice(0, 4)],
    leads: ["meet:hale", "talk:toby", "meet:mia", "meet:dobbs", "meet:thorne"],
    retracted: ["toby_blames_thorne"],
    conclusions: ["nobody_broke_in"],
    talk: {
      stance: "shaken",
      says_first: [],
      asks: ["toby_no_key"],
      gates: ["clue_toby_mia_splat~", "toby_blames_mia~"],
      story: ["toby_alibi", "toby_blames_thorne-", "clue_toby_thorne_ladder", "toby_drops_burglar"],
      established: 2,
      keeps_back: 1,
    },
  },
  {
    event: line("toby", { opened: ["toby_blames_mia"] }),
    turns: 5,
    revealed: ["toby_blames_mia"],
    notebook: [...SEARCHED, ...TOBY_LINES],
    leads: ["meet:hale", "meet:mia", "meet:dobbs", "meet:thorne"],
    retracted: ["toby_blames_thorne"],
    conclusions: ["nobody_broke_in"],
    talk: {
      stance: "shaken",
      says_first: [],
      asks: ["toby_no_key"],
      gates: ["clue_toby_mia_splat~", "toby_not_mia~"],
      story: ["toby_alibi", "toby_blames_thorne-", "clue_toby_thorne_ladder", "toby_drops_burglar", "toby_blames_mia"],
      established: 2,
      keeps_back: 1,
    },
  },
  {
    event: { type: "talk", character: "mia" },
    turns: 6,
    revealed: ["mia_alibi", "react_mia_pen"],
    notebook: [...SEARCHED, ...TOBY_LINES, "mia_alibi"],
    leads: ["meet:hale", "*talk:mia", "meet:dobbs", "meet:thorne"],
    retracted: ["toby_blames_thorne"],
    conclusions: ["nobody_broke_in"],
    talk: {
      stance: "open",
      says_first: [],
      asks: ["clue_mia_thorne_barbecue"],
      gates: ["mia_admits_splat~"],
      story: ["mia_alibi"],
      established: 1,
      keeps_back: 0,
    },
  },
  {
    event: { type: "move", location: "thorne_garden" },
    turns: 7,
    revealed: [],
    notebook: [...SEARCHED, ...TOBY_LINES, "mia_alibi"],
    leads: ["meet:hale", "talk:mia", "meet:dobbs", "meet:thorne"],
    retracted: ["toby_blames_thorne"],
    conclusions: ["nobody_broke_in"],
  },
  {
    event: { type: "talk", character: "thorne" },
    turns: 8,
    revealed: ["thorne_alibi", "clue_thorne_mia_cake", "thorne_never_set_foot", "react_thorne_boot"],
    notebook: [...SEARCHED, ...TOBY_LINES, "mia_alibi", ...THORNE],
    leads: ["meet:hale", "*talk:toby", "talk:mia", "meet:dobbs", "*talk:thorne"],
    retracted: ["toby_blames_thorne"],
    conclusions: ["nobody_broke_in"],
    talk: {
      stance: "guarded",
      says_first: [],
      asks: [],
      gates: ["clue_thorne_measured~", "thorne_ladder_thursday~"],
      story: THORNE,
      established: 1,
      keeps_back: 0,
    },
  },
  {
    event: line("thorne", { opened: ["clue_thorne_measured"] }),
    turns: 8,
    revealed: ["clue_thorne_measured"],
    notebook: BEFORE_DOBBS,
    leads: ["meet:hale", "talk:toby", "talk:mia", "meet:dobbs", "talk:thorne"],
    retracted: ["toby_blames_thorne", "thorne_never_set_foot"],
    conclusions: ["nobody_broke_in", "prints_explained"],
    talk: {
      stance: "cleared",
      says_first: [],
      asks: [],
      gates: ["thorne_ladder_thursday~"],
      story: ["thorne_alibi", "clue_thorne_mia_cake", "thorne_never_set_foot-", "clue_thorne_measured"],
      established: 1,
      keeps_back: 0,
    },
  },
  {
    event: { type: "move", location: "workshop" },
    turns: 9,
    revealed: [],
    notebook: BEFORE_DOBBS,
    leads: ["meet:hale", "talk:toby", "talk:mia", "meet:dobbs", "talk:thorne"],
    retracted: ["toby_blames_thorne", "thorne_never_set_foot"],
    conclusions: ["nobody_broke_in", "prints_explained"],
  },
  {
    event: { type: "talk", character: "dobbs" },
    turns: 10,
    revealed: ["dobbs_rounds", "react_dobbs_slippers"],
    notebook: [...BEFORE_DOBBS, "dobbs_rounds", "react_dobbs_slippers"],
    leads: ["meet:hale", "talk:toby", "talk:mia", "*talk:dobbs", "talk:thorne"],
    retracted: ["toby_blames_thorne", "thorne_never_set_foot"],
    conclusions: ["nobody_broke_in", "prints_explained"],
    talk: {
      stance: "open",
      says_first: [],
      asks: ["clue_dobbs_crash_time"],
      gates: [],
      story: ["dobbs_rounds"],
      established: 1,
      keeps_back: 0,
    },
  },
  {
    event: line("dobbs", { asked: ["clue_dobbs_crash_time"] }),
    turns: 10,
    revealed: ["clue_dobbs_crash_time"],
    notebook: AFTER_DOBBS,
    leads: ["meet:hale", "talk:toby", "talk:mia", "talk:thorne"],
    retracted: ["toby_blames_thorne", "thorne_never_set_foot"],
    conclusions: SOLVED,
    talk: {
      stance: "open",
      says_first: [],
      asks: [],
      gates: [],
      story: ["dobbs_rounds", "clue_dobbs_crash_time"],
      established: 1,
      keeps_back: 0,
    },
  },
  {
    event: { type: "move", location: "potting_shed" },
    turns: 11,
    revealed: [],
    notebook: AFTER_DOBBS,
    leads: ["meet:hale", "talk:toby", "talk:mia", "talk:thorne"],
    retracted: ["toby_blames_thorne", "thorne_never_set_foot"],
    conclusions: SOLVED,
  },
  {
    event: { type: "talk", character: "toby" },
    turns: 12,
    revealed: [],
    notebook: AFTER_DOBBS,
    leads: ["meet:hale", "talk:toby", "talk:mia", "talk:thorne"],
    retracted: ["toby_blames_thorne", "thorne_never_set_foot"],
    conclusions: SOLVED,
    talk: {
      stance: "shaken",
      says_first: [],
      asks: ["toby_no_key"],
      gates: ["clue_toby_mia_splat~", "toby_not_mia~"],
      story: ["toby_alibi", "toby_blames_thorne-", "clue_toby_thorne_ladder", "toby_drops_burglar", "toby_blames_mia"],
      established: 2,
      keeps_back: 1,
    },
  },
  {
    event: line("toby", { opened: ["toby_not_mia"] }),
    turns: 12,
    revealed: ["toby_not_mia"],
    notebook: [...AFTER_DOBBS, "toby_not_mia"],
    leads: ["meet:hale", "talk:toby", "talk:mia", "talk:thorne"],
    retracted: ["toby_blames_thorne", "thorne_never_set_foot", "toby_blames_mia"],
    conclusions: SOLVED,
    talk: {
      stance: "cornered",
      says_first: [],
      asks: ["toby_no_key"],
      gates: ["clue_toby_mia_splat~", "toby_confession"],
      story: [
        "toby_alibi",
        "toby_blames_thorne-",
        "clue_toby_thorne_ladder",
        "toby_drops_burglar",
        "toby_blames_mia-",
        "toby_not_mia",
      ],
      established: 2,
      keeps_back: 0,
    },
  },
  {
    event: line("toby", { opened: ["toby_confession"] }),
    turns: 12,
    revealed: ["toby_confession"],
    notebook: [...AFTER_DOBBS, "toby_not_mia", "toby_confession"],
    leads: ["meet:hale", "talk:mia", "talk:thorne"],
    retracted: [
      "toby_blames_thorne",
      "thorne_never_set_foot",
      "toby_blames_mia",
      "toby_alibi",
      "toby_no_key",
    ],
    conclusions: SOLVED,
    talk: {
      stance: "cleared",
      says_first: [],
      asks: [],
      gates: ["clue_toby_mia_splat~"],
      story: [
        "toby_alibi-",
        "toby_blames_thorne-",
        "clue_toby_thorne_ladder",
        "toby_drops_burglar",
        "toby_blames_mia-",
        "toby_not_mia",
        "toby_confession",
      ],
      established: 2,
      keeps_back: 0,
    },
  },
];

/** Gates as `id` with `~` when a bluff opens them; statements as `id` with `-` once taken back. */
function summarise(graph: ClueGraphCase, events: ClueGraphEvent[], character: string): TalkSummary {
  const play = replay(graph, events);
  const state = talkState(graph, play, character);
  const idOf = (says: string) => Object.keys(graph.clues).find((id) => graph.clues[id].text === says)!;
  return {
    stance: state.stance,
    says_first: state.says_first.map((entry) => entry.id),
    asks: state.answers_if_asked.map((entry) => entry.id),
    gates: state.gates.map((gate) => gate.id + (gate.bluffable ? "~" : "")),
    story: state.story_so_far.map((entry) => idOf(entry.says) + (entry.taken_back ? "-" : "")),
    established: state.established.length,
    keeps_back: state.keeps_back.length,
  };
}

describe("the greenhouse scripted play", () => {
  const graph = greenhouse();

  it("starts with every character to meet, all new", () => {
    expect(deriveClueGraph(graph, []).leads).toEqual(
      ALL_MEET.map((key) => expect.objectContaining({ key, new: true })),
    );
    expect(talkState(graph, replay(graph, [{ type: "move", location: "potting_shed" }]), "toby").says_first.map((entry) => entry.id)).toEqual(
      ["toby_alibi", "react_toby_trainers", "toby_blames_thorne"],
    );
  });

  SCRIPT.forEach((step, index) => {
    it(`after action ${index + 1}: ${JSON.stringify(step.event)}`, () => {
      const events = SCRIPT.slice(0, index + 1).map((entry) => entry.event);
      const before = replay(graph, events.slice(0, -1));
      const { revealed, rejected } = applyEvent(graph, before, step.event);
      const derived = deriveClueGraph(graph, events);
      expect(revealed).toEqual(step.revealed);
      expect(rejected).toEqual([]);
      expect(derived.play.turns).toBe(step.turns);
      expect(derived.notebook.map((entry) => entry.id)).toEqual(step.notebook);
      expect(derived.leads.map((lead) => (lead.new ? "*" : "") + lead.key)).toEqual(step.leads);
      expect(derived.play.retracted).toEqual(step.retracted);
      expect(derived.conclusions).toEqual(step.conclusions);
      const spoken = step.event.type === "talk" || step.event.type === "line" ? step.event.character : null;
      if (spoken) expect(summarise(graph, events, spoken)).toEqual(step.talk);
      else expect(step.talk).toBeUndefined();
    });
  });

  it("marks a taken-back statement in the notebook and never lists a conclusion", () => {
    const { notebook: entries } = deriveClueGraph(graph, SCRIPT.map((step) => step.event));
    const takenBack = entries.filter((entry) => entry.taken_back).map((entry) => entry.id);
    expect(takenBack).toEqual(["toby_alibi", "toby_blames_thorne", "toby_blames_mia", "thorne_never_set_foot"]);
    const conclusionTexts = Object.values(graph.conclusions).map((conclusion) => conclusion.text);
    for (const entry of entries) expect(conclusionTexts).not.toContain(entry.text);
    expect(entries.find((entry) => entry.id === "clue_glass_outside")?.from).toBe("The Greenhouse: the broken side window");
    expect(entries.find((entry) => entry.id === "toby_alibi")?.from).toBe("Toby");
  });

  it("keeps Toby, before his first word, to the stories a withheld gate would take back", () => {
    const shed: ClueGraphEvent[] = [{ type: "move", location: "potting_shed" }];
    const state = talkState(graph, replay(graph, shed), "toby");
    expect(state.stance).toBe("guarded");
    expect(state.demeanor).toBe(graph.characters.toby.demeanor.guarded);
    expect(state.keeps_back).toEqual([graph.clues.toby_blames_thorne.text, graph.clues.toby_alibi.text]);
    const greeted = talkState(graph, replay(graph, [SHED, { type: "talk", character: "toby" }]), "toby");
    expect(greeted.keeps_back).toEqual([graph.clues.toby_alibi.text]);
    expect(greeted.established).toEqual([graph.clues.react_toby_sweeping.text, graph.clues.react_toby_trainers.text]);
  });
});

describe("gates", () => {
  it("keeps a physical gate shut without its use clue, and rejects a report that opens it", () => {
    const graph = greenhouse();
    graph.clues.clue_thorne_measured = {
      ...graph.clues.clue_thorne_measured,
      reached: { by: "gated", gate: { after: ["thorne_never_set_foot"], use: { any: ["clue_boot_prints"] }, physical: true } },
    } as ClueGraphCase["clues"][string];
    const met = replay(graph, [GARDEN, { type: "talk", character: "thorne" }]);
    expect(availableGates(graph, met, "thorne").map((gate) => gate.id)).toEqual(["thorne_ladder_thursday"]);
    const step = applyEvent(graph, met, line("thorne", { opened: ["clue_thorne_measured"] }));
    expect(step.revealed).toEqual([]);
    expect(step.rejected).toEqual(["clue_thorne_measured"]);

    const armed = replay(graph, [{ type: "search" }, GARDEN, { type: "talk", character: "thorne" }]);
    expect(availableGates(graph, armed, "thorne")).toContainEqual({ id: "clue_thorne_measured", bluffable: false });
  });

  it("offers a non-physical gate without its use clue, marked bluffable, and a bluff opens it", () => {
    const graph = greenhouse();
    const met = replay(graph, [GARDEN, { type: "talk", character: "thorne" }]);
    expect(availableGates(graph, met, "thorne")).toEqual([
      { id: "clue_thorne_measured", bluffable: true },
      { id: "thorne_ladder_thursday", bluffable: true },
    ]);
    const [gate] = talkState(graph, met, "thorne").gates;
    expect(gate.opens_with.show).toEqual({
      match: "any",
      clues: [{ id: "clue_boot_prints", text: graph.clues.clue_boot_prints.text, held: false }],
    });
    expect(gate.takes_back).toEqual([graph.clues.thorne_never_set_foot.text]);
    const step = applyEvent(graph, met, line("thorne", { opened: ["clue_thorne_measured"] }));
    expect(step.revealed).toEqual(["clue_thorne_measured"]);
    expect(step.play.retracted).toEqual(["thorne_never_set_foot"]);
  });

  it("stops offering a gated statement taken back before it was said", () => {
    const graph = greenhouse();
    graph.clues.toby_not_mia = {
      ...graph.clues.toby_not_mia,
      reached: { by: "gated", gate: { use: { any: ["clue_thorne_mia_cake"] } } },
    } as ClueGraphCase["clues"][string];
    const met = replay(graph, [SHED, { type: "talk", character: "toby" }]);
    const cleared = applyEvent(graph, met, line("toby", { opened: ["toby_not_mia"] })).play;
    expect(cleared.retracted).toContain("toby_blames_mia");
    expect(availableGates(graph, cleared, "toby").map((gate) => gate.id)).not.toContain("toby_blames_mia");
  });

  it("opens an all-of physical gate only once every clue is held", () => {
    const graph = greenhouse();
    graph.clues.toby_blames_mia = {
      ...graph.clues.toby_blames_mia,
      reached: { by: "gated", gate: { use: { all: ["clue_welly_prints", "clue_key_in_water_butt"] }, physical: true } },
    } as ClueGraphCase["clues"][string];
    const ids = (events: ClueGraphEvent[]) =>
      availableGates(graph, replay(graph, events), "toby").map((gate) => gate.id);
    const welly: ClueGraphEvent = { type: "search", spot: "the smashed pumpkin" };
    const key: ClueGraphEvent = { type: "search", spot: "the water butt by the door" };
    expect(ids([welly])).not.toContain("toby_blames_mia");
    expect(ids([welly, key])).toContain("toby_blames_mia");
    const gate = talkState(graph, replay(graph, [welly, key]), "toby").gates.find((entry) => entry.id === "toby_blames_mia");
    expect(gate?.opens_with.show?.match).toBe("all");
    expect(gate?.bluffable).toBe(false);
  });

  it("gives a gate with only after when asked plainly, and a worded gate its line", () => {
    const graph = greenhouse();
    const state = talkState(graph, replay(graph, SCRIPT.slice(0, 17).map((step) => step.event)), "toby");
    expect(state.gates.find((gate) => gate.id === "toby_confession")?.opens_with).toEqual({ asked_plainly: true });
    const hale = replay(graph, [SHED, { type: "search", spot: "the watering rota on the door" }, { type: "move", location: "greenhouse" }, { type: "talk", character: "hale" }, line("hale", { opened: ["hale_toby_fine"] })]);
    const upset = talkState(graph, hale, "hale").gates.find((gate) => gate.id === "clue_hale_toby_upset");
    expect(upset?.opens_with).toMatchObject({ line: expect.stringContaining("They promise to be fair to Toby") });
    expect(upset?.with).toEqual([]);
    expect(talkState(graph, hale, "hale").stance).toBe("guarded");
  });
});

describe("narrator reports", () => {
  const graph = greenhouse();
  const met = replay(graph, [SHED, { type: "talk", character: "toby" }]);

  it("drops what the state did not offer, and says so", () => {
    const step = applyEvent(graph, met, line("toby", { opened: ["toby_confession", "toby_alibi", "nothing"], asked: ["toby_alibi", "toby_no_key"], seen: ["react_toby_pocket"] }));
    expect(step.rejected).toEqual(["toby_confession", "toby_alibi", "nothing", "toby_alibi", "react_toby_pocket"]);
    expect(step.revealed).toEqual(["clue_toby_thorne_ladder", "toby_no_key", "react_toby_pocket"]);
  });

  it("refuses an event the game could never record", () => {
    expect(() => applyEvent(graph, met, line("mia", {}))).toThrow(/outside a conversation/);
    expect(() => applyEvent(graph, met, { type: "talk", character: "dobbs" })).toThrow(/not at/);
    expect(() => applyEvent(graph, met, { type: "talk", character: "nobody" })).toThrow(/No character/);
    expect(() => applyEvent(graph, met, { type: "move", location: "moon" })).toThrow(/No location/);
    const searched = applyEvent(graph, met, { type: "search" });
    expect(() => applyEvent(graph, searched.play, line("toby", {}))).toThrow(/outside a conversation/);
  });

  it("records a subject tell once shown, in the notebook when a question depends on it", () => {
    const changed = greenhouse();
    changed.clues.react_dobbs_slippers = {
      ...changed.clues.react_dobbs_slippers,
      reached: { by: "seen", subject: "the noise last night" },
    } as ClueGraphCase["clues"][string];
    const events: ClueGraphEvent[] = [{ type: "move", location: "workshop" }, { type: "talk", character: "dobbs" }];
    const state = talkState(changed, replay(changed, events), "dobbs");
    expect(state.shows_when).toEqual([{ id: "react_dobbs_slippers", subject: "the noise last night", does: changed.clues.react_dobbs_slippers.text }]);
    expect(currentLeads(changed, replay(changed, events)).map((lead) => lead.key)).not.toContain("talk:dobbs");
    events.push(line("dobbs", { seen: ["react_dobbs_slippers"] }));
    const derived = deriveClueGraph(changed, events);
    expect(derived.notebook.map((entry) => entry.id)).toEqual(["dobbs_rounds", "react_dobbs_slippers"]);
    expect(derived.leads).toContainEqual(expect.objectContaining({ key: "talk:dobbs", new: true }));
    expect(applyEvent(changed, derived.play, line("dobbs", { seen: ["react_dobbs_slippers"] })).rejected).toEqual(["react_dobbs_slippers"]);
  });

  it("stops offering a statement already taken back", () => {
    const solved = replay(graph, SCRIPT.map((step) => step.event));
    expect(talkState(graph, solved, "toby").answers_if_asked).toEqual([]);
    expect(applyEvent(graph, solved, line("toby", { asked: ["toby_no_key"] })).rejected).toEqual(["toby_no_key"]);
  });
});

describe("conclusions and hidden spots", () => {
  it("drops a conclusion once one of its clues is taken back", () => {
    const graph = greenhouse();
    graph.conclusions.thorne_stayed_out = {
      text: "Mr. Thorne never came into the school garden.",
      resolves: "what Mr. Thorne says",
      rule: { all: ["thorne_never_set_foot"] },
    };
    validateClueGraph(graph);
    const events: ClueGraphEvent[] = [{ type: "search" }, GARDEN, { type: "talk", character: "thorne" }];
    expect(deriveClueGraph(graph, events).conclusions).toContain("thorne_stayed_out");
    events.push(line("thorne", { opened: ["clue_thorne_measured"] }));
    expect(deriveClueGraph(graph, events).conclusions).not.toContain("thorne_stayed_out");
  });

  it("hides a spot until its pointer is held, then leads to it until it is searched", () => {
    const graph = greenhouse();
    graph.locations.greenhouse.spots[2].revealed_by = "clue_hale_toby_upset";
    validateClueGraph(graph);
    const bench: ClueGraphEvent = { type: "search", spot: "the toppled bench" };
    const events: ClueGraphEvent[] = HALE_EVENTS.slice(0, 6);
    const hidden = deriveClueGraph(graph, events);
    expect(visibleSpots(graph, hidden.play, "greenhouse")).not.toContain("the toppled bench");
    expect(hidden.play.held).not.toContain("clue_snapped_bench");
    expect(hidden.leads.filter((lead) => lead.key.startsWith("spot:"))).toEqual([]);

    events.push(HALE_EVENTS[6]);
    const shown = deriveClueGraph(graph, events);
    expect(visibleSpots(graph, shown.play, "greenhouse")).toContain("the toppled bench");
    const lead = shown.leads.find((entry) => entry.key.startsWith("spot:"));
    expect(lead).toMatchObject({ new: true, text: "Something new to search at The Greenhouse: the toppled bench." });

    events.push(bench);
    const searched = deriveClueGraph(graph, events);
    expect(searched.play.held).toContain("clue_snapped_bench");
    expect(searched.leads.filter((entry) => entry.key.startsWith("spot:"))).toEqual([]);
    expect(notebook(graph, searched.play).at(-1)?.from).toBe("The Greenhouse: the toppled bench");
  });

  it("finds nothing at a spot the location does not have", () => {
    const graph = greenhouse();
    const step = applyEvent(graph, replay(graph, []), { type: "search", spot: "the roof" });
    expect(step.revealed).toEqual([]);
    expect(step.play.turns).toBe(1);
    expect(step.play.searched).toEqual([]);
  });
});

describe("what never leaks", () => {
  const graph = greenhouse();
  graph.locations.greenhouse.spots[2].revealed_by = "clue_hale_toby_upset";
  const prefixes = [
    ...SCRIPT.map((_, index) => SCRIPT.slice(0, index + 1).map((step) => step.event)),
    ...HALE_EVENTS.map((_, index) => HALE_EVENTS.slice(0, index + 1)),
  ];
  const gated = Object.values(graph.clues).filter(
    (clue) => clue.kind === "statement" && clue.reached.by === "gated",
  );

  it("keeps clue text, a line's wording and conclusions out of every lead", () => {
    const forbidden = [
      ...Object.values(graph.clues).map((clue) => clue.text),
      ...gated.flatMap((clue) => (clue.kind === "statement" && clue.reached.by === "gated" && clue.reached.gate.line ? [clue.reached.gate.line.text] : [])),
      ...Object.values(graph.conclusions).map((conclusion) => conclusion.text),
    ];
    const leads = prefixes.flatMap((events) => deriveClueGraph(graph, events).leads);
    expect(leads.some((lead) => lead.key.startsWith("spot:"))).toBe(true);
    for (const lead of leads)
      for (const text of forbidden) expect(lead.text).not.toContain(text.slice(0, 24));
  });

  it("never puts a gated clue's text in keeps back", () => {
    const texts = new Set(gated.map((clue) => clue.text));
    let kept = 0;
    for (const events of [[], [SHED], ...prefixes]) {
      const play = replay(graph, events);
      for (const character of Object.keys(graph.characters))
        for (const entry of talkState(graph, play, character).keeps_back) {
          kept += 1;
          expect(texts.has(entry)).toBe(false);
        }
    }
    expect(kept).toBeGreaterThan(0);
  });
});
