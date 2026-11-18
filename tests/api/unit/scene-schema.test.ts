import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SceneManifestSchema,
  validateSceneManifest,
} from "../../../packages/shared/src/scene-schema.ts";
import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { buildSceneGenerationInput } from "../../../packages/blueprint-generator/src/scene-prompt.ts";
import {
  createProceduralScene,
  createSceneManifest,
} from "../../testkit/src/fixtures.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

describe("scene recipes", () => {
  it("ships complete, validated scenery for both playable settings", () => {
    for (const file of [
      "the-missing-lighthouse-lens.json",
      "the-missing-heartwood.json",
    ]) {
      const blueprint = BlueprintV2Schema.parse(
        JSON.parse(fs.readFileSync(path.join("blueprints", file), "utf8")),
      );
      const manifest = validateSceneManifest(
        JSON.parse(
          fs.readFileSync(
            path.join("blueprint-scenes", `${blueprint.id}.json`),
            "utf8",
          ),
        ),
        blueprint,
      );
      expect(manifest.scenes.map((scene) => scene.location_id).sort()).toEqual(
        blueprint.world.locations.map((location) => location.id).sort(),
      );
    }
  });

  it("rejects executable fields, external assets, oversized scenes, invalid transforms, duplicate ids, and degenerate cameras", () => {
    const scene = createProceduralScene();
    const manifest = createSceneManifest({ scenes: [scene] });
    for (const invalid of [
      { ...scene, script: "alert(1)" },
      {
        ...scene,
        objects: [
          { ...scene.objects[0], url: "https://example.com/model.glb" },
        ],
      },
      { ...scene, objects: Array(181).fill(scene.objects[0]) },
      { ...scene, objects: [scene.objects[0], scene.objects[0]] },
      { ...scene, objects: [{ ...scene.objects[0], scale: [-1, 1, 1] }] },
      { ...scene, camera: { position: [0, 0, 0], target: [0, 0, 0] } },
      {
        ...scene,
        objects: [{ ...scene.objects[0], position: [Infinity, 0, 0] }],
      },
    ])
      expect(
        SceneManifestSchema.safeParse({ ...manifest, scenes: [invalid] })
          .success,
      ).toBe(false);
    expect(
      SceneManifestSchema.safeParse({ ...manifest, scenes: [scene, scene] })
        .success,
    ).toBe(false);
    expect(() =>
      validateSceneManifest(
        { ...manifest, blueprint_id: "a3f5c9d1-4e7b-4a2c-9f81-6b0d2e5a7c34" },
        BlueprintV2Schema.parse(validBlueprintV2),
      ),
    ).toThrow("another blueprint");
    expect(() =>
      validateSceneManifest(
        { ...manifest, scenes: [{ ...scene, location_id: "unknown" }] },
        BlueprintV2Schema.parse(validBlueprintV2),
      ),
    ).toThrow("Unknown scene location");
  });

  it("sends only public location and visual fields to generation", () => {
    const blueprint = BlueprintV2Schema.parse(validBlueprintV2);
    blueprint.ground_truth.what_happened = "PRIVATE SOLUTION";
    blueprint.metadata.visual_direction = { art_style: "paper diorama", color_palette: "teal and gold", mood: "cozy", lighting: "daylight", portrait_background: "PRIVATE PORTRAIT BACKDROP" };
    const location = blueprint.world.locations[0];
    for (const clue of location.clues) clue.text = "PRIVATE CLUE";
    location.sub_locations = [{ id: "area", name: "Public cupboard", hint: "PRIVATE HINT", clues: [] }];
    const prompt = buildSceneGenerationInput(blueprint, location.id);
    expect(prompt.userMessage).toContain(location.description);
    expect(prompt.userMessage).not.toContain("PRIVATE");
    expect(Object.keys(JSON.parse(prompt.userMessage))).toEqual([
      "visual_direction",
      "location",
    ]);
    expect(prompt.answerSchema).toHaveProperty("type", "object");
    expect(() => buildSceneGenerationInput(blueprint, "missing")).toThrow(
      "Unknown scene location",
    );
  });
});
