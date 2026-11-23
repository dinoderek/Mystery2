import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClueGraphCaseSchema } from "../../../packages/shared/src/clue-graph-schema.ts";
import { buildClueGraphWorld } from "../../../packages/shared/src/clue-graph-case.ts";
import { main } from "../../../scripts/dev-cli.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-images-"));
  dirs.push(dir);
  const graph = ClueGraphCaseSchema.parse(JSON.parse(fs.readFileSync("blueprints/clue-graph/greenhouse-prizewinner.json", "utf8")));
  const file = path.join(dir, "case.json");
  return { dir, file, graph };
}

describe("./dev gen-images on clue-graph cases", () => {
  it.each([true, false])("generates, saves and projects artwork with optional direction: %s", async (artwork) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { dir, file, graph } = fixture();
    const person = Object.keys(graph.characters)[0];
    const location = Object.keys(graph.locations)[0];
    if (artwork) {
      graph.cover = { facts: ["A pumpkin on a ribbon-covered table."], characters: [person], locations: [location] };
      graph.visual_direction = { art_style: "Paper collage", color_palette: "Gold and green", mood: "Curious", lighting: "Afternoon" };
    } else {
      delete graph.cover;
      delete graph.visual_direction;
    }
    fs.writeFileSync(file, JSON.stringify(graph));
    const requests: Array<{ prompt: string; input_references?: unknown[] }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("stub image").toString("base64"), media_type: "image/png" }] }), { status: 200 });
    });
    const err: string[] = [];
    const status = await main(["gen-images", "--blueprint-path", file, "--output-dir", path.join(dir, "images"), "--all"], {
      root: process.cwd(), out: () => {}, err: (text: string) => err.push(text),
      env: { MYSTERY_CONFIG_ROOT: dir, OPENROUTER_API_KEY: "stub-key" },
      imageDependencies: { fetchImpl },
    });
    expect(err).toEqual([]);
    expect(status).toBe(0);
    expect(requests).toHaveLength(Object.keys(graph.characters).length + Object.keys(graph.locations).length + 1);
    for (const character of Object.values(graph.characters)) {
      const portrait = requests.find(({ prompt }) => prompt.includes(`Name: ${character.name}.`));
      expect(portrait).toBeDefined();
      for (const fact of character.appearance) expect(portrait?.prompt).toContain(fact);
    }
    const cover = requests.at(-1)!;
    if (artwork) {
      expect(cover.prompt).toContain(graph.cover!.facts[0]);
      expect(cover.prompt).toContain("Paper collage");
      expect(cover.input_references).toHaveLength(2);
    } else {
      expect(cover.prompt).toContain(graph.metadata.title);
    }
    for (const place of Object.values(graph.locations)) {
      const scene = requests.find(({ prompt }) => prompt.includes(`Location: ${place.name}.`));
      for (const fact of place.facts) expect(scene?.prompt).toContain(fact);
    }
    const patched = ClueGraphCaseSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    const view = buildClueGraphWorld(patched);
    expect(view.metadata.image_id).toBe(patched.metadata.image_id);
    expect(view.metadata.image_id).toBeTruthy();
    for (const character of view.world.characters) {
      expect(character.portrait_image_id).toBe(patched.characters[character.id].portrait_image_id);
      expect(fs.existsSync(path.join(dir, "images", character.portrait_image_id!))).toBe(true);
    }
    for (const location of view.world.locations) {
      expect(location.location_image_id).toBe(patched.locations[location.id].location_image_id);
      expect(fs.existsSync(path.join(dir, "images", location.location_image_id!))).toBe(true);
    }
    expect(patched.clues).toEqual(graph.clues);
    expect(patched.truth).toEqual(graph.truth);
  });
});
