// The greenhouse clue-graph case played start to finish over HTTP on the mock
// narrator: to a win on a supported culprit, and to a loss.

import { describe, expect, it } from "vitest";
import { clueGraphCaseId, GameTurnResponseSchema } from "@my2/shared";
import { API_URL, sendLine, setupApiTestAuth } from "../integration/helpers";

async function playThrough(tag: string, lines: string[]) {
  const auth = await setupApiTestAuth(tag);
  const started = await fetch(`${API_URL}/game-start`, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({ blueprint_id: clueGraphCaseId("greenhouse-prizewinner") }),
  });
  expect(started.status).toBe(200);
  const { game_id: gameId } = await started.json();
  const enter = await fetch(`${API_URL}/game-enter`, { method: "POST", headers: auth.headers, body: JSON.stringify({ game_id: gameId }) });
  expect(enter.status).toBe(200);
  const clues: string[] = [];
  let last = null;
  for (const line of lines) {
    const response = await sendLine(auth, gameId, line);
    expect(response.status, line).toBe(200);
    last = GameTurnResponseSchema.parse(await response.json());
    if (last.kind === "turn") clues.push(...last.revealed_clues.map((clue) => clue.id));
  }
  return { last, clues };
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
