import { describe, expect, it } from "vitest";
import {
  GameStartResponseSchema,
  GameGetResponseSchema,
  GameTurnResponseSchema,
} from "@my2/shared";
import { API_URL, setupApiTestAuth, sendLine } from "./helpers.ts";

const MSF_ID = "46e4e135-82fe-4389-af0b-80aa749867a1";
const V2_ID = "7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47";

describe("selectable paired MSF case", () => {
  it("lists V2 before MSF, plays and resumes the native case, and keeps the graph private and profile-scoped", async () => {
    const entries = (await (await fetch(`${API_URL}/blueprints-list`)).json())
      .blueprints as Array<{ id: string; title: string }>;
    const original = entries.findIndex((entry) => entry.id === V2_ID);
    const alternative = entries.findIndex((entry) => entry.id === MSF_ID);
    expect(original).toBeGreaterThanOrEqual(0);
    expect(alternative).toBeGreaterThan(original);
    expect(entries[alternative].title).toContain("MSF experiment");
    const owner = await setupApiTestAuth("msf-owner");
    const other = await setupApiTestAuth("msf-other");
    const started = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: owner.headers,
      body: JSON.stringify({ blueprint_id: MSF_ID }),
    });
    expect(started.status).toBe(200);
    const body = GameStartResponseSchema.parse(await started.json());
    const gameId = body.game_id;
    expect(body.narration_events[0].payload).toMatchObject({
      case_format: "msf/0.1.0",
      case_revision: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /msf_snapshot|knows_fact_ids|f_roz_stole/,
    );
    expect(
      (
        await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
          headers: other.headers,
        })
      ).status,
    ).toBe(404);
    expect((await sendLine(other, gameId, "search")).status).toBe(404);
    expect(
      (
        await fetch(`${API_URL}/game-enter`, {
          method: "POST",
          headers: owner.headers,
          body: JSON.stringify({ game_id: gameId }),
        })
      ).status,
    ).toBe(200);
    for (const input of [
      "talk to Ada",
      "What did you hear?",
      "Why did you set your alarm?",
      "bye",
      "go keepers_cottage",
      "search tide schedule",
      "talk to Finn",
      "What happened?",
      "Who was in the cottage?",
      "bye",
      "go village_quay",
      "search",
      "search harbour tide board",
      "search causeway steps",
    ]) {
      const response = await sendLine(owner, gameId, input);
      expect(response.status, input).toBe(200);
      GameTurnResponseSchema.parse(await response.json());
    }
    const resumed = GameGetResponseSchema.parse(
      await (
        await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
          headers: owner.headers,
        })
      ).json(),
    );
    expect(resumed.state).toMatchObject({ mode: "accuse", time_remaining: 0 });
    expect(
      (resumed.state.discovered_clues ?? []).map((clue) => clue.id),
    ).toContain("c_velvet_scrap");
    expect(JSON.stringify(resumed)).not.toMatch(
      /msf_snapshot|knows_fact_ids|supported_rule_ids/,
    );
    await sendLine(owner, gameId, "Roz took the lens");
    const won = GameTurnResponseSchema.parse(
      await (await sendLine(owner, gameId, "Roz took the lens")).json(),
    );
    expect(won.kind === "turn" && won.result).toBe("win");
  });
});
