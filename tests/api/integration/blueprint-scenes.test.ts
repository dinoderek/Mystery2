import { describe, expect, it } from "vitest";
import { BlueprintScenesResponseSchema } from "../../../packages/shared/src/mystery-api-contracts";
import { API_URL, MOCK_BLUEPRINT_ID } from "./helpers";

describe("public scene artwork", () => {
  it("serves validated recipes without a profile and leaves private blueprint data on the server", async () => {
    const id = "7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47";
    const response = await fetch(
      `${API_URL}/blueprint-scenes?blueprint_id=${id}`,
    );
    expect(response.status).toBe(200);
    const data = BlueprintScenesResponseSchema.parse(await response.json());
    expect(data.scenes.map((scene) => scene.location_id)).toEqual([
      "lantern_room",
      "keepers_cottage",
      "village_quay",
    ]);
    expect(Object.keys(data).sort()).toEqual([
      "blueprint_id",
      "scenes",
      "schema_version",
    ]);
    expect(JSON.stringify(data)).not.toContain("ground_truth");
    expect(JSON.stringify(data)).not.toContain("is_culprit");
  });

  it("validates requests and distinguishes absent artwork from an unknown case", async () => {
    for (const query of [
      "",
      "?blueprint_id=../escape",
      "?blueprint_id=not-a-uuid",
    ]) {
      expect((await fetch(`${API_URL}/blueprint-scenes${query}`)).status).toBe(
        400,
      );
    }
    expect(
      (
        await fetch(
          `${API_URL}/blueprint-scenes?blueprint_id=00000000-0000-4000-8000-000000000000`,
        )
      ).status,
    ).toBe(404);
    const response = await fetch(
      `${API_URL}/blueprint-scenes?blueprint_id=${MOCK_BLUEPRINT_ID}`,
    );
    expect(response.status).toBe(200);
    expect(
      BlueprintScenesResponseSchema.parse(await response.json()).scenes,
    ).toEqual([]);
    expect(
      (await fetch(`${API_URL}/blueprint-scenes`, { method: "POST" })).status,
    ).toBe(405);
  });
});
