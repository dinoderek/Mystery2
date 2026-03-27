import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runImageGeneration } from "../../../scripts/generate-blueprint-images.mjs";

const blueprintFixture = {
  schema_version: "v2",
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "Mock Blueprint",
    one_liner: "A simple mystery",
    target_age: 8,
    time_budget: 10,
    art_style: "storybook watercolor",
  },
  narrative: {
    premise: "Someone stole the cookies.",
    starting_knowledge: {
      mystery_summary: "The cookies vanished from the kitchen around noon.",
      locations: [
        { location_id: "loc_kitchen", summary: "Where the cookies were kept." },
      ],
      characters: [
        { character_id: "char_alice", summary: "The baker; ran the kitchen." },
      ],
    },
  },
  world: {
    starting_location_id: "loc_kitchen",
    locations: [
      {
        id: "loc_kitchen",
        name: "Kitchen",
        description: "A kitchen",
        clues: [],
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
        background: "Baker",
        personality: "Nervous",
        initial_attitude_towards_investigator: "guarded",
        stated_alibi: "Reading",
        motive: "Hungry",
        is_culprit: true,
        clues: [],
        flavor_knowledge: [],
        actual_actions: [{ sequence: 1, summary: "Ate cookies" }],
      },
    ],
  },
  cover_image: {
    description: "A mysterious kitchen with cookie crumbs and a shadowy figure.",
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

const ONE_PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

function extractPromptText(body: Record<string, unknown>): string {
  const content = (body.messages as Array<{ content: unknown }>)?.[0]?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textPart = content.find(
      (part: { type: string }) => part.type === "text",
    );
    return textPart?.text ?? "";
  }
  return "";
}

function mockFetch(url: string | URL, init?: RequestInit) {
  if (String(url).includes("/chat/completions")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = extractPromptText(body);

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
  it("rejects V1 blueprints", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-flow-v1-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const v1Blueprint = { ...blueprintFixture, schema_version: undefined };
    await writeFile(blueprintPath, JSON.stringify(v1Blueprint, null, 2), "utf-8");

    await expect(
      runImageGeneration(
        {
          blueprintPath,
          outputDir: path.join(tmpDir, "images"),
          model: "openai/gpt-image-1",
          scope: "all",
          dryRun: false,
          characterKeys: [],
          locationKeys: [],
        },
        { fetchImpl: mockFetch, apiKey: "test-key" },
      ),
    ).rejects.toThrow("V1 blueprints are no longer supported");
  });

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

  it("passes character portrait images as references when generating location scenes", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-flow-refs-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const apiCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const allSuccessFetch = (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      apiCalls.push({ url: String(url), body });
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
    };

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
        fetchImpl: allSuccessFetch,
        apiKey: "test-key",
      },
    );

    expect(result.results.length).toBe(3);
    expect(result.results.every((r: { status: string }) => r.status === "generated")).toBe(true);

    // Phase ordering: character (phase 1), location (phase 2), blueprint cover (phase 3).
    // Phase 1 (character) should use plain string content — no references.
    const characterCall = apiCalls[0];
    const charContent = (characterCall.body.messages as Array<{ content: unknown }>)[0].content;
    expect(typeof charContent).toBe("string");

    // Phase 2 (location) should have multi-part content with portrait references.
    const locationCall = apiCalls[1];
    const locContent = (locationCall.body.messages as Array<{ content: unknown }>)[0].content;
    expect(Array.isArray(locContent)).toBe(true);
    const locParts = locContent as Array<{ type: string }>;
    const locImageParts = locParts.filter((p) => p.type === "image_url");
    expect(locImageParts.length).toBe(1); // 1 character at this location
    const locTextParts = locParts.filter((p) => p.type === "text");
    expect((locTextParts[0] as unknown as { text: string }).text).toContain("Image 1: Portrait of Alice");

    // Phase 3 (cover) should have multi-part content with portrait + location references.
    const coverCall = apiCalls[2];
    const coverContent = (coverCall.body.messages as Array<{ content: unknown }>)[0].content;
    expect(Array.isArray(coverContent)).toBe(true);
    const coverParts = coverContent as Array<{ type: string }>;
    const coverImageParts = coverParts.filter((p) => p.type === "image_url");
    // 1 portrait (char_alice) + 1 location scene (loc_kitchen)
    expect(coverImageParts.length).toBe(2);
    const coverTextParts = coverParts.filter((p) => p.type === "text");
    expect((coverTextParts[0] as unknown as { text: string }).text).toContain("Image 1: Portrait of Alice");
    expect((coverTextParts[0] as unknown as { text: string }).text).toContain("Image 2: Location scene");
  });
});
