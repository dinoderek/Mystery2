import { afterEach, describe, expect, it, vi } from "vitest";
import { describeTranscriptDiff, normalizeTranscript } from "../../testkit/src/golden/compare";
import { BrowserDriver, type GameDriver, type LineOutcome } from "../../testkit/src/golden/driver";
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

describe("BrowserDriver", () => {
  const driver = () => new BrowserDriver({ apiUrl: "http://x/api", headers: {}, gameId: "g1", start: START });

  afterEach(() => vi.unstubAllGlobals());

  it("answers refusals and help itself, in the store's wording", async () => {
    const d = driver();
    expect(await d.submit("go")).toEqual({ kind: "refused", hint: "Where to? Try: Attic, Barn, Cleo Park." });
    expect(await d.submit("go to the moon")).toEqual({
      kind: "refused",
      hint: '"the moon" is not a valid destination. Try: Attic, Barn, Cleo Park.',
    });
    expect(await d.submit("talk to")).toEqual({ kind: "refused", hint: "Who do you want to talk to? Try: Cleo Park." });
    expect(await d.submit("talk to Zed")).toEqual({
      kind: "refused",
      hint: '"zed" is not a valid character. Try: Cleo Park.',
    });
    expect(await d.submit("dance")).toMatchObject({ kind: "refused" });
    expect(await d.submit("help")).toEqual({ kind: "view", overlay: "help", section: null, echo: true, note: "Help menu opened." });
    expect(await d.submit("n")).toEqual({ kind: "view", overlay: "notebook", section: null, echo: false, note: null });
  });

  it("routes an action to its endpoint and names the page after the place", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          narration_parts: [{ text: "You arrive.", speaker: narrator }],
          current_location: "loc-b",
          visible_characters: [],
          time_remaining: 4,
          mode: "explore",
          current_talk_character: null,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await driver().submit("go to barn");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/api/game-move",
      expect.objectContaining({ body: JSON.stringify({ game_id: "g1", destination: "loc-b" }) }),
    );
    expect(outcome).toMatchObject({
      kind: "turn",
      mode: "explore",
      time_remaining: 4,
      result: null,
      events: [{ event_type: "move", payload: { location_name: "Barn" } }],
    });
  });

  it("sends a line said in accuse mode to the accusation as reasoning", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ narration_parts: [], time_remaining: 4, mode: "ended", result: "lose", current_talk_character: null })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const d = new BrowserDriver({ apiUrl: "http://x/api", headers: {}, gameId: "g1", start: { ...START, mode: "accuse" } });

    const outcome = await d.submit("it was Cleo");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/api/game-accuse",
      expect.objectContaining({ body: JSON.stringify({ game_id: "g1", player_reasoning: "it was Cleo" }) }),
    );
    expect(outcome).toMatchObject({
      result: "lose",
      events: [{ event_type: "accuse_round", narration_parts: [{ text: "Action completed." }] }],
    });
  });

  it("fails loudly when the game answers an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    await expect(driver().submit("go to barn")).rejects.toThrow("game-move answered 503");
  });
});
