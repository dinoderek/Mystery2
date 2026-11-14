import { afterEach, describe, expect, it, vi } from "vitest";
import { describeTranscriptDiff, normalizeTranscript } from "../../testkit/src/golden/compare";
import { TurnDriver, type GameDriver, type LineOutcome } from "../../testkit/src/golden/driver";
import { Screen } from "../../testkit/src/golden/screen";

const narrator = { kind: "narrator", key: "narrator", label: "Narrator" } as const;
const line = (text: string) => ({ text, speaker: narrator, image_id: null });

const START = {
  locations: [
    { id: "loc-a", name: "Attic" },
    { id: "loc-b", name: "Barn" },
  ],
  characters: [{ id: "c-1", first_name: "Cleo", last_name: "Park", location_id: "loc-a" }],
  location: "loc-a",
  mode: "explore" as const,
  time_remaining: 5,
};

/** A driver that answers each line with the outcome queued for it. */
function scripted(outcomes: LineOutcome[]): GameDriver {
  const queue = [...outcomes];
  const next = async () => {
    const outcome = queue.shift();
    if (!outcome) throw new Error("no outcome queued");
    return outcome;
  };
  return { enter: next, submit: next };
}

function newScreen() {
  return new Screen({
    mysteryTitle: "The Case",
    mode: "explore",
    time_remaining: 5,
    events: [{ event_type: "start", narration_parts: [line("Premise.")] }],
  });
}

describe("normalizeTranscript", () => {
  it("replaces generated ids and timestamps and keeps fixture ids", () => {
    const text = "game 123e4567-e89b-12d3-a456-426614174000 at 2026-11-13T22:15:20.577Z in loc-kitchen  ";
    expect(normalizeTranscript(text)).toBe("game <id> at <time> in loc-kitchen");
  });
});

describe("describeTranscriptDiff", () => {
  it("is null for identical transcripts", () => {
    expect(describeTranscriptDiff("g", "a\nb\n", "a\nb\n")).toBeNull();
  });

  it("names the game and the first differing line", () => {
    const message = describeTranscriptDiff("the-game", "a\nb\nc\n", "a\nB\nc\n");
    expect(message).toContain('"the-game"');
    expect(message).toContain("line 2");
    expect(message).toContain("expected: b");
    expect(message).toContain("actual:   B");
  });

  it("reports a transcript that stops early", () => {
    expect(describeTranscriptDiff("g", "a\nb", "a")).toContain("(no such line)");
  });
});

describe("Screen", () => {
  it("echoes lines, builds pages and keeps the turns left after each step", async () => {
    const screen = newScreen();
    await screen.play(
      scripted([
        { kind: "turn", mode: "explore", time_remaining: 5, clues: [], result: null, events: [{ event_type: "move", payload: { location_name: "Attic" }, narration_parts: [line("You arrive.")] }] },
        { kind: "refused", hint: "Try again." },
        { kind: "view", overlay: "notebook", section: "places", echo: false, note: null },
        { kind: "turn", mode: "explore", time_remaining: 4, clues: [{ id: "k1", text: "A key" }], result: null, events: [{ event_type: "search", narration_parts: [line("A key!")] }] },
        { kind: "turn", mode: "explore", time_remaining: 3, clues: [{ id: "k1", text: "A key" }], result: null, events: [{ event_type: "search", narration_parts: [line("Again.")] }] },
      ]),
      [{ enter: true }, "dance", "locations", "search", "search"],
    );

    const text = screen.render("g", "bp");
    expect(text).toContain('  3  "locations"  mode=explore turns=5 opens=notebook/places');
    expect(text).toContain('  4  "search"  mode=explore turns=4 clues=k1');
    // A clue already found is not reported again.
    expect(text).toContain('  5  "search"  mode=explore turns=3\n');
    expect(text).toContain('  page 0 opening "The Case"');
    expect(text).toContain('  page 1 location "Attic"');
    // The echo of the line that opened the page sits on it, and a notebook leaves none.
    expect(text).toContain('step 1 | Narrator (narrator): "You arrive."');
    expect(text).toContain('step 2 | You (investigator): "dance"');
    expect(text).not.toContain("You (investigator): \"locations\"");
  });

  it("ends the case on a quit or a result and refuses to go on", async () => {
    const quit = newScreen();
    await quit.play(scripted([{ kind: "quit" }]), ["quit"]);
    expect(quit.render("g", "bp")).toContain("mode=ended");
    await expect(quit.play(scripted([]), ["more"])).rejects.toThrow("goes on after the case ended");

    const won = newScreen();
    await won.play(
      scripted([{ kind: "turn", mode: "ended", time_remaining: 2, clues: [], result: "win", events: [{ event_type: "accuse_resolved", narration_parts: [line("Yes.")] }] }]),
      ["Cleo"],
    );
    expect(won.render("g", "bp")).toContain("result=win");
    await expect(won.play(scripted([]), ["more"])).rejects.toThrow();
  });
});

describe("TurnDriver", () => {
  const driver = (mode: "explore" | "accuse" = "explore") =>
    new TurnDriver({ apiUrl: "http://x/api", headers: {}, gameId: "g1", start: { ...START, mode } });

  afterEach(() => vi.unstubAllGlobals());

  function answering(...answers: unknown[]) {
    const queue = [...answers];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(queue.shift())));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const state = (overrides: Record<string, unknown> = {}) => ({
    mode: "explore",
    time_remaining: 4,
    location: "loc-a",
    current_talk_character: null,
    ...overrides,
  });

  it("sends the line as typed to game-turn", async () => {
    const fetchMock = answering({ kind: "refused", reason: "missing-target", hint: "Where to? Try: Attic, Barn." });

    expect(await driver().submit("go")).toEqual({ kind: "refused", hint: "Where to? Try: Attic, Barn." });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/api/game-turn",
      expect.objectContaining({ body: JSON.stringify({ game_id: "g1", input: "go" }) }),
    );
  });

  it("opens help with its note and the notebook without one", async () => {
    answering(
      { kind: "view", view: "help", section: null },
      { kind: "view", view: "locations", section: "places" },
      { kind: "quit" },
    );
    const d = driver();

    expect(await d.submit("help")).toEqual({ kind: "view", overlay: "help", section: null, echo: true, note: "Help menu opened." });
    expect(await d.submit("locations")).toEqual({ kind: "view", overlay: "notebook", section: "places", echo: false, note: null });
    expect(await d.submit("quit")).toEqual({ kind: "quit" });
  });

  it("shows the saved events and names a page after the place the game is in", async () => {
    answering({
      kind: "turn",
      events: [
        { sequence: 3, event_type: "move", payload: { location_name: "Barn" }, narration_parts: [line("You arrive.")] },
        { sequence: 4, event_type: "forced_endgame", payload: {}, narration_parts: [line("Time is up.")] },
      ],
      state: state({ mode: "accuse", time_remaining: 0, location: "loc-b" }),
      revealed_clues: [],
      result: null,
    });

    expect(await driver().submit("go to barn")).toEqual({
      kind: "turn",
      mode: "accuse",
      time_remaining: 0,
      clues: [],
      result: null,
      events: [
        { event_type: "move", payload: { location_name: "Barn" }, narration_parts: [line("You arrive.")] },
        { event_type: "forced_endgame", payload: undefined, narration_parts: [line("Time is up.")] },
      ],
    });
  });

  it("opens the accusation for reasoning given with `accuse`, and not for a later round", async () => {
    const round = (mode: string) => ({
      kind: "turn",
      events: [{ sequence: 5, event_type: "accuse_round", payload: null, narration_parts: [line("Go on.")] }],
      state: state({ mode }),
      revealed_clues: [],
      result: null,
    });
    answering(round("accuse"), round("accuse"));
    const d = driver();

    expect(await d.submit("accuse Cleo")).toMatchObject({ events: [{ event_type: "accuse_start" }] });
    expect(await d.submit("because of the key")).toMatchObject({ events: [{ event_type: "accuse_round" }] });
  });

  it("reports the clues found and the result", async () => {
    answering({
      kind: "turn",
      events: [{ sequence: 9, event_type: "accuse_resolved", payload: null, narration_parts: [line("Solved.")] }],
      state: state({ mode: "ended" }),
      revealed_clues: [],
      result: "win",
    });

    expect(await driver("accuse").submit("it was Cleo")).toMatchObject({ mode: "ended", result: "win" });
  });

  it("fails loudly when the game answers an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    await expect(driver().submit("go to barn")).rejects.toThrow("game-turn answered 503");
  });
});
