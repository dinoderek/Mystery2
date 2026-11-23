import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SceneManifestSchema,
  validateSceneManifest,
} from "../../../packages/shared/src/scene-schema.ts";
import { createProceduralScene, createSceneManifest } from "../../testkit/src/fixtures.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

const MOCK_SCENES = path.join("tests", "testkit", "src", "mock-case-scenes.json");

describe("scene recipes", () => {
  it("accepts a procedural recipe and rejects the retired lighthouse kind", () => {
    const scene = createProceduralScene();
    expect(SceneManifestSchema.safeParse(createSceneManifest({ scenes: [scene] })).success).toBe(true);
    const lighthouse = { kind: "lighthouse", location_id: scene.location_id, label: scene.label };
    expect(
      SceneManifestSchema.safeParse({ ...createSceneManifest(), scenes: [lighthouse] }).success,
    ).toBe(false);
  });

  it("the mock case's test scenes are complete and valid for the mock case", () => {
    const mock = readMockCase();
    const manifest = validateSceneManifest(JSON.parse(fs.readFileSync(MOCK_SCENES, "utf8")), mock);
    expect(manifest.blueprint_id).toBe(mock.id);
    expect(manifest.scenes.map((scene) => scene.location_id).sort()).toEqual(
      mock.world.locations.map((location) => location.id).sort(),
    );
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
        readMockCase(),
      ),
    ).toThrow("another blueprint");
    expect(() =>
      validateSceneManifest(
        { ...manifest, blueprint_id: readMockCase().id, scenes: [{ ...scene, location_id: "unknown" }] },
        readMockCase(),
      ),
    ).toThrow("Unknown scene location");
  });
});
