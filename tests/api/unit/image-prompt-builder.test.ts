import { describe, expect, it } from "vitest";

import {
  buildImagePrompt,
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
  it("builds blueprint cover prompt with age context and starting location", () => {
    const coverPrompt = buildImagePrompt(blueprint, {
      targetType: "blueprint",
      targetKey: null,
    });
    expect(coverPrompt).toContain("Target: Mystery cover image");
    expect(coverPrompt).toContain("storybook watercolor");
    expect(coverPrompt).toContain("aged 8");
    expect(coverPrompt).toContain("Kitchen");
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
    expect(locationPrompt).not.toContain("Reference portrait images");
  });

  it("adds reference image hint to location prompt when referenceImageCount is provided", () => {
    const locationPrompt = buildImagePrompt(
      blueprint,
      { targetType: "location", targetKey: "loc_kitchen" },
      { referenceImageCount: 2 },
    );
    expect(locationPrompt).toContain("Reference portrait images of the 2 character(s)");
    expect(locationPrompt).toContain("Preserve their appearance");
  });

  it("creates unique slugged image ids", () => {
    const imageId = createImageId(blueprint.id, "character", "char_alice");
    expect(imageId).toMatch(
      /^character-char-alice-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
