import { describe, expect, it } from "vitest";

import {
  buildImagePrompt,
  createImageId,
} from "../../../scripts/lib/image-prompt-builder.mjs";

const blueprint = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "Mock Blueprint",
    one_liner: "A simple test mystery.",
    visual: {
      style: "storybook watercolor",
      mood: "cozy mystery",
      palette: "warm red and cream",
      lighting_or_atmosphere: "soft kitchen light",
      cover: {
        summary: "A playful cookie mystery cover.",
        visual_anchors: ["cookie jar", "detective notebook"],
      },
    },
  },
  world: {
    locations: [{
      location_key: "kitchen",
      name: "Kitchen",
      visual: { summary: "A warm kitchen.", visual_anchors: ["cookie jar", "mixing bowl"] },
    }],
    characters: [{
      character_key: "alice",
      first_name: "Alice",
      visual: { summary: "A worried baker.", visual_anchors: ["red hair", "apron"] },
    }],
  },
};

describe("image prompt builder", () => {
  it("builds blueprint, character, and location prompt variants", () => {
    const coverPrompt = buildImagePrompt(blueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    const characterPrompt = buildImagePrompt(blueprint, {
      targetType: "character",
      targetKey: "alice",
    });
    const locationPrompt = buildImagePrompt(blueprint, {
      targetType: "location",
      targetKey: "kitchen",
    });

    expect(coverPrompt).toContain("Target: Mystery cover image");
    expect(coverPrompt).toContain("storybook watercolor");
    expect(characterPrompt).toContain("Target: Character portrait");
    expect(characterPrompt).toContain("Alice");
    expect(locationPrompt).toContain("Target: Location scene image");
    expect(locationPrompt).toContain("Kitchen");
  });

  it("creates unique slugged image ids", () => {
    const imageId = createImageId(blueprint.id, "character", "alice");
    expect(imageId).toMatch(
      /^character-alice-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
