// Plays the scripted games over HTTP under the mock narrator and compares what
// the player would see with the transcripts committed in `golden/transcripts/`.
// `GOLDEN_RECORD=1` writes them instead of comparing (docs/testing.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeTranscriptDiff, normalizeTranscript } from "../../testkit/src/golden/compare";
import { playScriptedGame } from "../../testkit/src/golden/play";
import { API_URL, setupApiTestAuth } from "../integration/helpers";
import { BLUEPRINT_IDS, GOLDEN_GAMES } from "./golden/games";

const TRANSCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden", "transcripts");
const RECORDING = process.env.GOLDEN_RECORD === "1";

describe("golden transcripts", () => {
  for (const game of GOLDEN_GAMES) {
    it(`${game.name} reads as recorded`, async () => {
      const auth = await setupApiTestAuth(`golden-${game.name}`);
      const screen = await playScriptedGame({
        apiUrl: API_URL,
        headers: auth.headers,
        blueprintId: BLUEPRINT_IDS[game.blueprint],
        script: game.script,
      });
      const actual = normalizeTranscript(screen.render(game.name, game.blueprint));
      const file = path.join(TRANSCRIPTS, `${game.name}.txt`);

      if (RECORDING) {
        fs.mkdirSync(TRANSCRIPTS, { recursive: true });
        fs.writeFileSync(file, actual);
        return;
      }

      if (!fs.existsSync(file)) {
        throw new Error(`No recorded transcript for "${game.name}". Record it with npm run test:golden:record.`);
      }
      const difference = describeTranscriptDiff(game.name, fs.readFileSync(file, "utf8"), actual);
      if (difference) throw new Error(difference);
    });
  }

  it("has a recorded transcript for every game and no other", () => {
    if (RECORDING) return;
    const recorded = fs.existsSync(TRANSCRIPTS) ? fs.readdirSync(TRANSCRIPTS).sort() : [];
    expect(recorded).toEqual(GOLDEN_GAMES.map((game) => `${game.name}.txt`).sort());
  });
});
