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
    starting_knowledge: ["The cookies vanished at noon."],
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
          overwrite: true,
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
});
