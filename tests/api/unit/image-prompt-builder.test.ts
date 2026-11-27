import { describe, expect, it } from "vitest";

import {
  buildImagePrompt,
  buildReferenceLegend,
  createImageId,
} from "../../../scripts/lib/image-prompt-builder.mjs";

const visualDirection = {
  art_style: "soft gouache illustration with visible brushwork",
  color_palette: "warm kitchen tones — butter yellow, terracotta, cream, sage green",
  mood: "cozy and inviting with a hint of mischief",
  lighting: "warm morning sunlight streaming through a large kitchen window, soft shadows",
  texture: "matte paper with subtle grain",
};

// The artwork view of a case (`projectClueGraphArtwork`), cut to one location
// and one character for assertion clarity.
const blueprint = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "Mock Blueprint",
    visual_direction: visualDirection,
  },
  narrative: { premise: "The cookie plate is empty and snack time is almost here." },
  world: {
    starting_location_id: "loc_kitchen",
    locations: [
      {
        id: "loc_kitchen",
        name: "Kitchen",
        description: "A messy kitchen.",
      },
    ],
    characters: [
      {
        id: "char_alice",
        first_name: "Alice",
        location_id: "loc_kitchen",
        sex: "female",
        appearance: "Red hair",
        personality: "Nervous but kind.",
      },
    ],
  },
  cover_image: {
    description: "A mysterious kitchen with cookie crumbs and a shadowy figure near the counter.",
    location_ids: ["loc_kitchen"],
    character_ids: ["char_alice"],
  },
};

describe("image prompt builder", () => {
  it("builds blueprint cover prompt from cover_image.description", () => {
    const coverPrompt = buildImagePrompt(blueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(coverPrompt).toContain("Target: Mystery cover image");
    expect(coverPrompt).toContain("Art style: soft gouache");
    expect(coverPrompt).toContain("Color palette: warm kitchen tones");
    expect(coverPrompt).toContain("Mood: cozy and inviting");
    expect(coverPrompt).toContain("Lighting: warm morning sunlight");
    expect(coverPrompt).toContain("Texture: matte paper");
    expect(coverPrompt).toContain("children aged 6 to 11");
    expect(coverPrompt).toContain("Creative direction:");
    expect(coverPrompt).toContain("mysterious kitchen with cookie crumbs");
    expect(coverPrompt).toContain("Featured location(s): Kitchen");
    expect(coverPrompt).toContain("Characters featured: Alice (Red hair)");
  });

  it("builds character portrait prompt with bokeh background and no location", () => {
    const characterPrompt = buildImagePrompt(blueprint, {
      targetType: "character",
      targetKey: "char_alice",
    });
    expect(characterPrompt).toContain("Target: Character portrait, head-and-shoulders framing");
    expect(characterPrompt).toContain("Name: Alice.");
    expect(characterPrompt).toContain("Sex: female");
    expect(characterPrompt).toContain("Personality cue: Nervous but kind.");
    expect(characterPrompt).toContain("bokeh");
    expect(characterPrompt).toContain("blurred");
    expect(characterPrompt).not.toContain("Environment: Kitchen");
  });

  it("uses the blueprint-provided portrait background when set", () => {
    const customBlueprint = {
      ...blueprint,
      metadata: {
        ...blueprint.metadata,
        visual_direction: {
          ...visualDirection,
          portrait_background: "flat wash of dusty rose fading into slate grey",
        },
      },
    };

    const prompt = buildImagePrompt(customBlueprint, {
      targetType: "character",
      targetKey: "char_alice",
    });
    expect(prompt).toContain(
      "Portrait background: flat wash of dusty rose fading into slate grey",
    );
    expect(prompt).not.toContain("bokeh");
  });

  it("keeps portrait_background out of cover and location prompts", () => {
    const customBlueprint = {
      ...blueprint,
      metadata: {
        ...blueprint.metadata,
        visual_direction: {
          ...visualDirection,
          portrait_background: "flat wash of dusty rose fading into slate grey",
        },
      },
    };

    for (const target of [
      { targetType: "blueprint", targetKey: null },
      { targetType: "location", targetKey: "loc_kitchen" },
    ]) {
      const prompt = buildImagePrompt(customBlueprint, target);
      expect(prompt).not.toContain("Portrait background");
      expect(prompt).not.toContain("dusty rose");
    }
  });

  it("builds location scene prompt with the characters present", () => {
    const locationPrompt = buildImagePrompt(blueprint, {
      targetType: "location",
      targetKey: "loc_kitchen",
    });
    expect(locationPrompt).toContain("Target: Location scene image");
    expect(locationPrompt).toContain("Kitchen");
    expect(locationPrompt).toContain("Alice");
    expect(locationPrompt).toContain("Red hair");
    expect(locationPrompt).toContain("arriving");
  });

  it("includes indexed reference legend when referenceImages are provided", () => {
    const refs = [
      { label: "Portrait of Alice Smith (Red hair)", buffer: Buffer.from([1]) },
      { label: "Portrait of Bob Jones (Short with glasses)", buffer: Buffer.from([2]) },
    ];
    const locationPrompt = buildImagePrompt(
      blueprint,
      { targetType: "location", targetKey: "loc_kitchen" },
      { referenceImages: refs },
    );
    expect(locationPrompt).toContain("Reference images (attached below in order):");
    expect(locationPrompt).toContain("- Image 1: Portrait of Alice Smith (Red hair)");
    expect(locationPrompt).toContain("- Image 2: Portrait of Bob Jones (Short with glasses)");
    expect(locationPrompt).toContain("Preserve the appearance");
  });

  it("buildReferenceLegend returns empty string for no references", () => {
    expect(buildReferenceLegend([])).toBe("");
    expect(buildReferenceLegend(undefined)).toBe("");
  });

  it("falls back to the house style when the case has no visual_direction", () => {
    const bareBlueprint = {
      ...blueprint,
      metadata: { ...blueprint.metadata, visual_direction: undefined },
    };
    const prompt = buildImagePrompt(bareBlueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(prompt).toContain("Style: storybook illustration, warm lighting, playful detective mood");
    expect(prompt).not.toContain("Art style:");
  });

  it("omits texture line when texture is not provided", () => {
    const noTextureBlueprint = {
      ...blueprint,
      metadata: {
        ...blueprint.metadata,
        visual_direction: { ...visualDirection, texture: undefined },
      },
    };
    const prompt = buildImagePrompt(noTextureBlueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(prompt).toContain("Art style:");
    expect(prompt).not.toContain("Texture:");
  });

  it("defaults the output framing to 4:3", () => {
    const prompt = buildImagePrompt(blueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(prompt).toContain("Output: one static image, 4:3 framing,");
  });

  it("tracks an explicit aspect ratio in the output framing", () => {
    const prompt = buildImagePrompt(
      blueprint,
      { targetType: "blueprint", targetKey: null },
      { aspectRatio: "16:9" },
    );
    expect(prompt).toContain("Output: one static image, 16:9 framing,");
    expect(prompt).not.toContain("4:3 framing");
  });

  it("drops the framing clause when the aspect ratio is auto", () => {
    const prompt = buildImagePrompt(
      blueprint,
      { targetType: "blueprint", targetKey: null },
      { aspectRatio: "auto" },
    );
    expect(prompt).toContain("Output: one static image, consistent visual style.");
    expect(prompt).not.toContain("framing");
  });

  it("creates deterministic slugged image ids with blueprint prefix", () => {
    const imageId = createImageId("Mock Blueprint", "character", "char_alice");
    expect(imageId).toBe("mock-blueprint.character-char-alice");

    const coverId = createImageId("Mock Blueprint", "blueprint");
    expect(coverId).toBe("mock-blueprint.blueprint");
  });
});
