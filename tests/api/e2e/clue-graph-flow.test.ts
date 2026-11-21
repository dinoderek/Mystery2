// The clue-graph cases played start to finish over HTTP on the mock narrator:
// the greenhouse to a win on a supported culprit and to a loss, and the dragon
// crown to a win through a retracted alibi and a hidden spot.

import { describe, expect, it } from "vitest";
import { clueGraphCaseId, GameTurnResponseSchema } from "@my2/shared";
import { API_URL, sendLine, setupApiTestAuth } from "../integration/helpers";

async function playThrough(tag: string, lines: string[], caseId = "greenhouse-prizewinner") {
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
  const clues: string[] = [];
  const takenBack: string[] = [];
  let last = null;
  for (const line of lines) {
    const response = await sendLine(auth, gameId, line);
    expect(response.status, line).toBe(200);
    last = GameTurnResponseSchema.parse(await response.json());
    if (last.kind === "turn") {
      clues.push(...last.revealed_clues.map((clue) => clue.id));
      takenBack.push(...(last.taken_back ?? []));
    }
  }
  return { last, clues, takenBack };
}

describe("the greenhouse clue-graph case", () => {
  it("is won on the welly prints with Mia cleared", async () => {
    const { last, clues } = await playThrough("clue-graph-win", [
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
    ]);
    expect(clues).toEqual(expect.arrayContaining(["clue_welly_prints", "clue_dobbs_crash_time", "clue_thorne_mia_cake"]));
    expect(last?.kind === "turn" && last.result).toBe("win");
    expect(last?.kind === "turn" && last.state.mode).toBe("ended");
  });

  it("is lost on an unsupported guess and the wrong suspect", async () => {
    const { last } = await playThrough("clue-graph-loss", [
      "accuse",
      "It was Toby",
      "Toby, because I say so",
      "Then it was Mr. Thorne",
      "Mr. Thorne, I am sure",
    ]);
    expect(last?.kind === "turn" && last.result).toBe("lose");
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
        "Leo did it: Mr. Pike saw him hide the crown behind the dragon, and it is there.",
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
      ["accuse", "It was Nina", "Nina, because I say so", "Then it was Sam", "Sam, I am sure"],
      "dragon-crown",
    );
    expect(last?.kind === "turn" && last.result).toBe("lose");
  });
});
