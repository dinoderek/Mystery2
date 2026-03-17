import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runImageGeneration } from "../../../scripts/generate-blueprint-images.mjs";

const blueprintFixture = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "Mock Blueprint",
    one_liner: "A simple mystery",
    target_age: 8,
    time_budget: 10,
    visual: {
      style: "storybook watercolor",
      mood: "cozy mystery",
      palette: "warm browns and red gingham",
      lighting_or_atmosphere: "soft kitchen afternoon light",
      cover: {
        summary: "A tray of cookies sits on a kitchen counter beside a magnifying glass.",
        visual_anchors: ["cookie tray", "kitchen counter", "magnifying glass"],
      },
    },
  },
  narrative: {
    premise: "Someone stole the cookies.",
    starting_knowledge: [],
  },
  world: {
    starting_location_key: "kitchen",
    locations: [{
      location_key: "kitchen",
      name: "Kitchen",
      description: "A kitchen",
      search_context: ["Fresh crumbs sit near the tray."],
      visual: {
        summary: "A warm kitchen with tiled walls and a cookie tray.",
        visual_anchors: ["cookie tray", "tiled walls", "red oven mitt"],
      },
    }],
    characters: [
      {
        character_key: "alice",
        first_name: "Alice",
        last_name: "Smith",
        location_key: "kitchen",
        roleplay: {
          persona: "Nervous baker",
          background: "Baker",
          attitude: "guarded",
        },
        private_alibi: "Reading",
        private_motive: "Hungry",
        visual: {
          summary: "A girl with bright red hair and a flour-dusted apron.",
          visual_anchors: ["red hair", "flour-dusted apron", "smudged sleeve"],
        },
      },
    ],
  },
  evidence: [
    {
      evidence_key: "crumbs-on-sleeve",
      player_text: "Cookie crumbs cling to Alice's sleeve.",
      fact_summary: "Alice has fresh cookie crumbs on her sleeve.",
      essential: true,
      related_location_keys: ["kitchen"],
      related_character_keys: ["alice"],
      acquisition_paths: [
        {
          surface: "talk",
          location_key: "kitchen",
          character_key: "alice",
        },
      ],
    },
    {
      evidence_key: "open-cookie-jar",
      player_text: "The cookie jar is still open on the counter.",
      fact_summary: "Someone took cookies from the jar in a hurry.",
      essential: true,
      related_location_keys: ["kitchen"],
      related_character_keys: ["alice"],
      acquisition_paths: [{ surface: "start", location_key: "kitchen" }],
    },
    {
      evidence_key: "kitchen-crumbs",
      player_text: "Fresh crumbs sit near the tray.",
      fact_summary: "Fresh crumbs remain where the cookies were taken.",
      essential: true,
      related_location_keys: ["kitchen"],
      related_character_keys: ["alice"],
      acquisition_paths: [{ surface: "search", location_key: "kitchen" }],
    },
  ],
  ground_truth: {
    culprit_character_key: "alice",
    what_happened: "Alice ate the cookies.",
    why_it_happened: "Hungry.",
    explanation:
      "Alice said she was reading, but the crumbs on her sleeve show she took the cookies in the kitchen.",
    suspect_truths: [
      {
        character_key: "alice",
        actual_activity: "Alice took the cookies in the kitchen.",
        stated_alibi: "I was reading.",
        motive: "Hungry",
        contradiction_evidence_keys: ["crumbs-on-sleeve", "open-cookie-jar"],
      },
    ],
    timeline: [
      {
        timeline_entry_key: "alice-takes-cookie",
        order: 1,
        character_key: "alice",
        location_key: "kitchen",
        summary: "Alice sneaks a cookie from the tray.",
      },
    ],
  },
};

const ONE_PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

function mockFetch(url: string | URL, init?: RequestInit) {
  if (String(url).includes("/chat/completions")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String(body.messages?.[0]?.content ?? "");

    if (prompt.includes("Location scene image")) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "upstream failure" }), { status: 503 }),
      );
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: `data:image/png;base64,${ONE_PIXEL_BASE64}`,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
  }

  return Promise.resolve(new Response(null, { status: 404 }));
}

describe("image generation flow", () => {
  it("patches successful targets while preserving failed target references", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-flow-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "all",
        overwrite: true,
        dryRun: false,
        characterKeys: [],
        locationKeys: [],
      },
      {
        fetchImpl: mockFetch,
        apiKey: "test-key",
      },
    );

    expect(result.results.length).toBe(3);
    const generated = result.results.filter(
      (entry: { status: string }) => entry.status === "generated",
    );
    const failed = result.results.filter(
      (entry: { status: string }) => entry.status === "failed",
    );
    expect(generated.length).toBe(2);
    expect(failed.length).toBe(1);
    expect(failed[0].target_type).toBe("location");

    const files = await readdir(outputDir);
    expect(files.length).toBe(2);

    const patched = JSON.parse(await readFile(blueprintPath, "utf-8"));
    expect(typeof patched.metadata.image_id).toBe("string");
    expect(typeof patched.world.characters[0].portrait_image_id).toBe("string");
    expect(patched.world.locations[0].location_image_id).toBeUndefined();
  });
});
