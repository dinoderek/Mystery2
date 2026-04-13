import { describe, expect, it } from "vitest";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import {
  buildImagePrompt,
  buildReferenceLegend,
  createImageId,
} from "../../../scripts/lib/image-prompt-builder.mjs";

const visualDirection = {
  art_style: "soft gouache illustration with visible brushwork",
  color_palette: "warm kitchen tones — butter yellow, terracotta, cream",
  mood: "cozy and inviting with a hint of mischief",
  lighting: "warm morning sunlight through a large window, soft shadows",
  texture: "matte paper with subtle grain",
};

const blueprint = {
  schema_version: "v2",
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "Mock Blueprint",
    one_liner: "A simple test mystery.",
    target_age: 8,
    time_budget: 10,
    art_style: "storybook watercolor",
    visual_direction: visualDirection,
  },
  narrative: {
    premise: "Someone stole the cookies.",
    starting_knowledge: {
      mystery_summary: "The cookies vanished from the kitchen around noon.",
      locations: [
        { location_id: "loc_kitchen", summary: "Where the cookies were kept." },
      ],
      characters: [
        { character_id: "char_alice", summary: "The head baker; ran the kitchen." },
      ],
    },
  },
  world: {
    starting_location_id: "loc_kitchen",
    locations: [
      {
        id: "loc_kitchen",
        name: "Kitchen",
        description: "A messy kitchen.",
        clues: [
          { id: "clue_crumbs", text: "Cookie crumbs on the counter.", role: "direct_evidence" },
        ],
      },
    ],
    characters: [
      {
        id: "char_alice",
        first_name: "Alice",
        last_name: "Smith",
        location_id: "loc_kitchen",
        sex: "female",
        appearance: "Red hair",
        background: "The head baker who runs the kitchen.",
        personality: "Nervous",
        initial_attitude_towards_investigator: "Guarded and evasive",
        stated_alibi: "Reading",
        motive: "Hungry",
        is_culprit: true,
        clues: [],
        flavor_knowledge: [],
        actual_actions: [{ sequence: 1, summary: "Ate the cookies." }],
      },
    ],
  },
  cover_image: {
    description: "A mysterious kitchen with cookie crumbs and a shadowy figure near the counter.",
    location_ids: ["loc_kitchen"],
    character_ids: ["char_alice"],
  },
  ground_truth: {
    what_happened: "Alice ate the cookies.",
    why_it_happened: "Hungry.",
    timeline: [],
  },
  solution_paths: [
    {
      id: "solution-crumbs",
      summary: "Follow the cookie crumbs.",
      description: "Cookie crumbs on the counter point to Alice.",
      location_clue_ids: ["clue_crumbs"],
      character_clue_ids: [],
    },
  ],
  red_herrings: [],
  suspect_elimination_paths: [],
};

// Validate against the Zod schema at definition time — any schema drift
// (added required fields, renamed keys, etc.) fails immediately.
BlueprintV2Schema.parse(blueprint);

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
    expect(coverPrompt).toContain("aged 8");
    expect(coverPrompt).toContain("Creative direction:");
    expect(coverPrompt).toContain("mysterious kitchen with cookie crumbs");
    expect(coverPrompt).toContain("Featured location(s): Kitchen");
    expect(coverPrompt).toContain("Characters featured: Alice Smith (Red hair)");
  });

  it("builds character portrait prompt with bokeh background and no location", () => {
    const characterPrompt = buildImagePrompt(blueprint, {
      targetType: "character",
      targetKey: "char_alice",
    });
    expect(characterPrompt).toContain("Target: Character portrait, head-and-shoulders framing");
    expect(characterPrompt).toContain("Alice Smith");
    expect(characterPrompt).toContain("Sex: female");
    expect(characterPrompt).toContain("Guarded and evasive");
    expect(characterPrompt).toContain("head baker");
    expect(characterPrompt).toContain("bokeh");
    expect(characterPrompt).toContain("blurred");
    expect(characterPrompt).not.toContain("Environment: Kitchen");
  });

  it("builds location scene prompt with characters and clue details", () => {
    const locationPrompt = buildImagePrompt(blueprint, {
      targetType: "location",
      targetKey: "loc_kitchen",
    });
    expect(locationPrompt).toContain("Target: Location scene image");
    expect(locationPrompt).toContain("Kitchen");
    expect(locationPrompt).toContain("Alice");
    expect(locationPrompt).toContain("Red hair");
    expect(locationPrompt).toContain("Cookie crumbs");
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

  it("falls back to legacy art_style when visual_direction is absent", () => {
    const legacyBlueprint = {
      ...blueprint,
      metadata: { ...blueprint.metadata, visual_direction: undefined },
    };
    const prompt = buildImagePrompt(legacyBlueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(prompt).toContain("Style: storybook watercolor");
    expect(prompt).not.toContain("Art style:");
    expect(prompt).not.toContain("Color palette:");
  });

  it("falls back to default style when both visual_direction and art_style are absent", () => {
    const bareBlueprint = {
      ...blueprint,
      metadata: {
        ...blueprint.metadata,
        visual_direction: undefined,
        art_style: undefined,
      },
    };
    const prompt = buildImagePrompt(bareBlueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(prompt).toContain("Style: storybook illustration, warm lighting, playful detective mood");
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

  it("creates deterministic slugged image ids with blueprint prefix", () => {
    const imageId = createImageId("Mock Blueprint", "character", "char_alice");
    expect(imageId).toBe("mock-blueprint.character-char-alice");

    const coverId = createImageId("Mock Blueprint", "blueprint");
    expect(coverId).toBe("mock-blueprint.blueprint");
  });
});
