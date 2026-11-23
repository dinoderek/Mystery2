import { describe, expect, it } from "vitest";
import { developmentCases, developmentInputs } from "../../../evaluation/runtime/experiments/grounding/cases.ts";
import { readBlueprint, validateCase } from "../../../evaluation/runtime/lib/case.ts";
import { playOf } from "../../../packages/game-engine/src/clue-graph/history.ts";

describe("frozen development inputs", () => {
  it("covers twelve fixed interactions per story on engine-produced, affordable histories", async () => {
    const cases = developmentCases();
    expect(cases).toHaveLength(36);
    expect(new Set(cases.map((one) => one.id)).size).toBe(36);
    for (const testCase of cases) {
      validateCase(testCase, testCase.id);
      const { blueprint } = await readBlueprint(testCase.blueprint.path, process.cwd());
      const play = playOf(blueprint.clue_graph!, testCase.given.history ?? []);
      expect(play.turns).toBeLessThan(blueprint.clue_graph!.metadata.time_budget);
      if (testCase.given.time_remaining !== undefined) expect(testCase.given.time_remaining).toBe((blueprint.clue_graph!.metadata.time_budget) - play.turns);
      if (testCase.action.type === "ask") expect(play.talking).toBe(testCase.given.talk_character_id);
    }
    const inputs = await developmentInputs(process.cwd());
    expect(inputs).toHaveLength(36);
    expect(inputs.every((one) => one.system && one.user)).toBe(true);
    expect(new Set(inputs.map((one) => one.id))).toEqual(new Set(cases.map((one) => one.id)));
  });
});
