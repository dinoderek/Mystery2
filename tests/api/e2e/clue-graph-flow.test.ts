// The clue-graph cases played start to finish over HTTP on the mock narrator:
// the greenhouse to a win after a failed accusation, to a loss on the third
// failure told in full, and to its last accusations out of turns; the kid-7
// self-play loss replayed into a win, and the dragon crown to a win through a
// retracted alibi and a hidden spot.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { clueGraphCaseId, GameTurnResponseSchema, validateClueGraph } from "@my2/shared";
import { API_URL, readStoredEvents, sendLine, setStoredTimeRemaining, setupApiTestAuth } from "../integration/helpers";

async function playThrough(
  tag: string,
  lines: string[],
  caseId = "greenhouse-prizewinner",
  prepare: (gameId: string) => void = () => {},
) {
  const auth = await setupApiTestAuth(tag);
  const started = await fetch(`${API_URL}/game-start`, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({ blueprint_id: clueGraphCaseId(caseId) }),
  });
  expect(started.status).toBe(200);
  const { game_id: gameId } = await started.json();
  const enter = await fetch(`${API_URL}/game-enter`, { method: "POST", headers: auth.headers, body: JSON.stringify({ game_id: gameId }) });
  expect(enter.status).toBe(200);
  prepare(gameId);
  const clues: string[] = [];
  const takenBack: string[] = [];
  let last = null;
  const answers = [];
  for (const line of lines) {
    const response = await sendLine(auth, gameId, line);
    expect(response.status, line).toBe(200);
    last = GameTurnResponseSchema.parse(await response.json());
    answers.push(last);
    if (last.kind === "turn") {
      clues.push(...last.revealed_clues.map((clue) => clue.id));
      takenBack.push(...(last.taken_back ?? []));
    }
  }
  const narration = last?.kind === "turn" ? last.events.flatMap((event) => event.narration_parts.map((part) => part.text)).join(" ") : "";
  return { last, clues, takenBack, narration, gameId, answers };
}

const greenhouse = () =>
  validateClueGraph(JSON.parse(fs.readFileSync("blueprints/clue-graph/greenhouse-prizewinner.json", "utf8")));

describe("the greenhouse clue-graph case", () => {
  it("is won on the welly prints with Mia cleared, after a failed accusation and more exploring", async () => {
    const { last, clues, answers } = await playThrough("clue-graph-win", [
      "search the smashed pumpkin",
      "go to the workshop",
      "talk to Mr. Dobbs",
      "What about the noise last night?",
      "bye",
      "accuse",
      "It was Toby.",
      "go to the garden",
      "talk to Mr. Thorne",
      "bye",
      "accuse Toby did it: his welly prints are in the pumpkin.",
    ]);
    const failed = answers[6];
    expect(failed.kind === "turn" && failed.events[0].event_type).toBe("accuse_failed");
    expect(failed.kind === "turn" && failed.state).toMatchObject({ mode: "explore", accusations_left: 2 });
    expect(clues).toEqual(expect.arrayContaining(["clue_welly_prints", "clue_dobbs_crash_time", "clue_thorne_mia_cake"]));
    expect(last?.kind === "turn" && last.result).toBe("win");
    expect(last?.kind === "turn" && last.state).toMatchObject({ mode: "ended", accusations_left: 2 });
  });

  it("is lost on the third failed accusation, and the ending tells the whole account", async () => {
    const { last, narration, answers } = await playThrough("clue-graph-loss", [
      "accuse",
      "It was Toby",
      "accuse Toby, because I say so",
      "accuse Mr. Thorne, I am sure",
    ]);
    expect(answers.map((answer) => answer.kind === "turn" && answer.state.accusations_left)).toEqual([3, 2, 1, 0]);
    expect(last?.kind === "turn" && last.result).toBe("lose");
    const { truth, conclusions } = greenhouse();
    for (const told of [conclusions.culprit_toby.text, truth.motive, ...truth.timeline]) expect(narration).toContain(told);
  });

  it("out of turns, refuses the way back and spends the accusations left back to back", async () => {
    const { last, answers } = await playThrough(
      "clue-graph-out-of-turns",
      ["search", "back", "It was Mia", "It was Mr. Thorne", "It was Mr. Dobbs"],
      "greenhouse-prizewinner",
      (gameId) => setStoredTimeRemaining(gameId, 1),
    );
    expect(answers[0].kind === "turn" && answers[0].state).toMatchObject({ mode: "accuse", time_remaining: 0, accusations_left: 3 });
    expect(answers[1]).toMatchObject({ kind: "refused", reason: "no-way-back" });
    expect(answers.slice(2, 4).map((answer) => answer.kind === "turn" && answer.state)).toEqual([
      expect.objectContaining({ mode: "accuse", accusations_left: 2 }),
      expect.objectContaining({ mode: "accuse", accusations_left: 1 }),
    ]);
    // With nowhere left to look, each failed reply asks for another try and points at no lead.
    for (const answer of answers.slice(2, 4)) {
      const reply = answer.kind === "turn" ? answer.events.flatMap((event) => event.narration_parts.map((part) => part.text)).join(" ") : "";
      expect(reply).toContain("Try your accusation again.");
      expect(reply).not.toContain("Think about this");
    }
    expect(last?.kind === "turn" && last.result).toBe("lose");
  });

  // A self-play game lost when the narrator judged the accusation: kid-7 accused
  // Mr. Dobbs first, then named Toby with the key and his pocket. Its run
  // output is not kept, so it is rebuilt from that account, holding the route
  // the key belongs to: the glass outside, the key in the water butt, the
  // spare-key book, Ms. Hale's key on its hook, and Mia cleared.
  it("is won by a game that named Toby with the key and his pocket after a wrong first name", async () => {
    const { last, clues, narration, gameId } = await playThrough("clue-graph-kid-7", [
      "talk to Ms. Hale",
      "What about the missing key?",
      "bye",
      "search the broken side window",
      "search the water butt by the door",
      "go to the workshop",
      "talk to Mr. Dobbs",
      "What about the noise last night?",
      "bye",
      "search",
      "go to the garden",
      "talk to Mr. Thorne",
      "bye",
      "go to the potting shed",
      "talk to Toby",
      "What about the missing key?",
      "bye",
      "accuse",
      "It was Mr. Dobbs. He would not give me a straight answer.",
      "accuse Toby! The key was hidden in the water butt, and he kept patting his pocket.",
    ]);
    expect(clues).toEqual(
      expect.arrayContaining([
        "clue_glass_outside",
        "clue_key_in_water_butt",
        "clue_spare_key_book",
        "clue_hale_key_last_seen",
        "clue_dobbs_crash_time",
        "clue_thorne_mia_cake",
        "react_toby_pocket",
      ]),
    );
    expect(clues).not.toContain("toby_confession");
    expect(last?.kind === "turn" && last.result).toBe("win");
    expect(narration).toContain(greenhouse().truth.motive);
    // The engine decided it, on the key the player cited.
    const decisions = readStoredEvents(gameId).flatMap((event) => {
      const saved = event.payload?.clue_graph_accusation;
      return saved ? [saved] : [];
    });
    expect(decisions).toEqual([
      expect.objectContaining({ accused: "dobbs", verdict: "not_yet" }),
      expect.objectContaining({ accused: "toby", verdict: "win", cited: expect.arrayContaining(["clue_key_in_water_butt"]) }),
    ]);
  });
});

describe("the dragon-crown clue-graph case", () => {
  it("is won on the crown found where Mr. Pike saw it hidden, after Sam takes back his alibi for Nina", async () => {
    const { last, clues, takenBack } = await playThrough(
      "clue-graph-dragon-crown",
      [
        "go to the art room",
        // Named before anyone points to it, the spot is not there.
        "search behind the big paper dragon",
        "go to the library",
        "search the sign-in sheet on the desk",
        "talk to Sam",
        "The sign-in sheet only has you on it: clue_signin_sheet. Was Nina really here?",
        "bye",
        "go to the playground",
        "talk to Mr. Pike",
        "What did you see through the art room window?",
        "bye",
        "go to the art room",
        "search behind the big paper dragon",
        "accuse",
        "It was Leo.",
        "accuse Leo did it: Mr. Pike saw him hide the crown behind the dragon, and it is there.",
      ],
      "dragon-crown",
    );
    expect(clues.filter((id) => id === "clue_crown_behind_dragon")).toHaveLength(1);
    expect(clues).toEqual(expect.arrayContaining(["sam_alibi_nina", "sam_retracts", "clue_pike_saw_bundle", "clue_crown_behind_dragon"]));
    // The first search found nothing; the crown came with the second, once the pointer was held.
    expect(clues.indexOf("clue_pike_saw_bundle")).toBeLessThan(clues.indexOf("clue_crown_behind_dragon"));
    // Taken back stays marked on every later turn; only Sam's alibi was ever retracted.
    expect([...new Set(takenBack)]).toEqual(["sam_alibi_nina"]);
    expect(last?.kind === "turn" && last.result).toBe("win");
    expect(last?.kind === "turn" && last.state.mode).toBe("ended");
  });

  it("is lost on Nina, whom the alibi never really cleared", async () => {
    const { last } = await playThrough(
      "clue-graph-dragon-crown-loss",
      ["accuse", "It was Nina", "accuse Nina, because I say so", "accuse Sam, I am sure"],
      "dragon-crown",
    );
    expect(last?.kind === "turn" && last.result).toBe("lose");
  });
});
