import { describe, expect, it } from "vitest";

import { generateBlueprint } from "../../../../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../../../../packages/shared/src/blueprint-schema-v2.ts";
import {
  getLiveSuiteTitle,
  getLiveTestTimeoutMs,
  isLiveAIEnabled,
} from "../../../testkit/src/live-ai.ts";

const runLive = isLiveAIEnabled() ? describe : describe.skip;

runLive(getLiveSuiteTitle("live-ai integration: blueprint generation"), () => {
  it("generates a schema-valid blueprint with the configured live model", async () => {
    const model = process.env.AI_MODEL?.trim();
    const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

    expect(model).toBeTruthy();
    expect(openRouterApiKey).toBeTruthy();

    const blueprint = await generateBlueprint({
      storyBrief: {
        brief:
          "A child-friendly mystery set in a school library where a special bookmark goes missing before story time.",
        targetAge: 8,
        timeBudget: 14,
        mustInclude: ["at least three suspects", "one red herring motive"],
      },
      model: model!,
      openRouterApiKey: openRouterApiKey!,
      requestId: "live-blueprint-generator-test",
    });

    expect(BlueprintV2Schema.parse(blueprint)).toEqual(blueprint);
    expect(blueprint.world.characters.length).toBeGreaterThan(1);
    expect(blueprint.world.locations.length).toBeGreaterThan(1);
  }, getLiveTestTimeoutMs());
});
