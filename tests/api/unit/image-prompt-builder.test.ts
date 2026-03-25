import { describe, expect, it } from "vitest";

import {
  buildImagePrompt,
  buildReferenceLegend,
  createImageId,
} from "../../../scripts/lib/image-prompt-builder.mjs";

const blueprint = {
  schema_version: "v2",
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "Mock Blueprint",
    one_liner: "A simple test mystery.",
    target_age: 8,
    time_budget: 10,
    art_style: "storybook watercolor",
  },
  narrative: {
    premise: "Someone stole the cookies.",
    starting_knowledge: ["The cookies vanished at noon."],
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
  solution_paths: [],
  red_herrings: [],
  suspect_elimination_paths: [],
};

describe("image prompt builder", () => {
  it("builds blueprint cover prompt from cover_image.description", () => {
    const coverPrompt = buildImagePrompt(blueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(coverPrompt).toContain("Target: Mystery cover image");
    expect(coverPrompt).toContain("storybook watercolor");
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

  it("creates unique slugged image ids", () => {
    const imageId = createImageId(blueprint.id, "character", "char_alice");
    expect(imageId).toMatch(
      /^character-char-alice-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
