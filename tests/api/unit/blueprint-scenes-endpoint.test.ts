import { describe, expect, it, vi } from "vitest";
import { handle } from "../../../packages/game-engine/src/endpoints/blueprint-scenes.ts";
import type { CatalogContext } from "../../../packages/game-engine/src/context.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

describe("scene artwork failures", () => {
  it("logs a broken asset once and returns a safe error while the game can continue", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const blueprint = readMockCase();
      const context: CatalogContext = {
        content: {
          listBlueprints: async () => [],
          loadBlueprint: async () => blueprint,
          loadScenes: async () => {
            throw new Error("Invalid scene file at a private filesystem path");
          },
        },
      };
      const response = await handle(
        new Request(
          `http://test/api/blueprint-scenes?blueprint_id=${blueprint.id}`,
        ),
        context,
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Scene artwork is unavailable",
      });
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
