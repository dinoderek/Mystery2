import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import {
  createProceduralScene,
  createSceneManifest,
} from "../../testkit/src/fixtures.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";
import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";

let dir: string;
let output: string[];
let errors: string[];
let config: string;
let blueprintFile: string;
let installed: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-scenes-"));
  output = [];
  errors = [];
  blueprintFile = path.join(dir, "blueprint.json");
  fs.writeFileSync(blueprintFile, JSON.stringify(validBlueprintV2));
  fs.writeFileSync(
    path.join(dir, "answer.json"),
    JSON.stringify(createProceduralScene()),
  );
  const stub = path.join(dir, "stub.mjs");
  fs.writeFileSync(
    stub,
    `import fs from 'node:fs';
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const answer=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
answer.location_id=input.location.id; answer.label=input.location.description;
fs.appendFileSync(process.argv[4],JSON.stringify(input)+'\\n');
process.stdout.write(JSON.stringify({result:JSON.stringify(answer)}));`,
  );
  config = path.join(dir, "config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      "scene-generator": {
        cmd: process.execPath,
        args: [
          stub,
          "{{user_message_file}}",
          path.join(dir, "answer.json"),
          path.join(dir, "captured.jsonl"),
        ],
        extract_path: "result",
        model: null,
        timeout_ms: 10000,
        retries: 0,
      },
    }),
  );
  installed = path.join(dir, "blueprint-scenes", `${validBlueprintV2.id}.json`);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function generate() {
  return runEval(
    [
      "scenes",
      blueprintFile,
      "--config",
      config,
      "--output-root",
      path.join(dir, "runs"),
      "--install",
    ],
    {
      root: dir,
      env: {},
      out: (line) => output.push(line),
      err: (line) => errors.push(line),
    },
    COMMANDS,
  );
}

function resultFiles(): string[] {
  return fs
    .readdirSync(path.join(dir, "runs"), {
      recursive: true,
      withFileTypes: true,
    })
    .filter((entry) => entry.isFile() && entry.name === "result.json")
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("scenes command", () => {
  it("rejects an unsupported location count before spending any model calls", async () => {
    const blueprint = BlueprintV2Schema.parse(validBlueprintV2);
    while (blueprint.world.locations.length < 25) {
      const index = blueprint.world.locations.length;
      blueprint.world.locations.push({
        id: `extra-${index}`,
        name: `Extra ${index}`,
        description: "A public room.",
        clues: [],
        sub_locations: [],
      });
    }
    fs.writeFileSync(blueprintFile, JSON.stringify(blueprint));
    expect(await generate()).toBe(1);
    expect(fs.existsSync(path.join(dir, "captured.jsonl"))).toBe(false);
  });
  it("runs the model wrapper per location, validates and installs its output, and records every call", async () => {
    expect(await generate()).toBe(0);
    expect(errors).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(installed, "utf8"));
    expect(
      manifest.scenes.map(
        (scene: { location_id: string }) => scene.location_id,
      ),
    ).toEqual(validBlueprintV2.world.locations.map((location) => location.id));
    const result = await readResult(resultFiles()[0]);
    expect(result.production?.calls).toHaveLength(
      validBlueprintV2.world.locations.length,
    );
    expect(result.summary.passed).toBe(true);
    const prompts = fs
      .readFileSync(path.join(dir, "captured.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const prompt of prompts) {
      expect(Object.keys(prompt)).toEqual(["visual_direction", "location"]);
      expect(prompt).not.toHaveProperty("ground_truth");
      expect(prompt.location).not.toHaveProperty("clues");
    }
  });

  it("preserves accepted recipes, generates only missing places, and can reuse a complete manifest without a model", async () => {
    fs.mkdirSync(path.dirname(installed));
    const accepted = {
      kind: "lighthouse" as const,
      location_id: validBlueprintV2.world.locations[0].id,
      label: "Accepted scene",
    };
    fs.writeFileSync(
      installed,
      JSON.stringify(
        createSceneManifest({
          blueprint_id: validBlueprintV2.id,
          scenes: [accepted],
        }),
      ),
    );
    expect(await generate()).toBe(0);
    expect(JSON.parse(fs.readFileSync(installed, "utf8")).scenes[0]).toEqual(
      accepted,
    );
    expect(
      fs
        .readFileSync(path.join(dir, "captured.jsonl"), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(validBlueprintV2.world.locations.length - 1);
    fs.unlinkSync(config);
    expect(await generate()).toBe(0);
    const results = await Promise.all(resultFiles().map(readResult));
    expect(results.some((result) => result.production === null)).toBe(true);
  });

  it("keeps installed artwork intact when generated output fails validation", async () => {
    fs.mkdirSync(path.dirname(installed));
    const before = JSON.stringify(
      createSceneManifest({ blueprint_id: validBlueprintV2.id, scenes: [] }),
    );
    fs.writeFileSync(installed, before);
    fs.writeFileSync(
      path.join(dir, "answer.json"),
      JSON.stringify({
        ...createProceduralScene(),
        script: "invalid executable content",
      }),
    );
    expect(await generate()).toBe(1);
    expect(fs.readFileSync(installed, "utf8")).toBe(before);
    const result = await readResult(resultFiles()[0]);
    expect(result.run_error?.stage).toBe("scene_generation");
    expect(result.production?.calls[0].attempts[0].outcome).toBe("invalid");
  });

  it("rejects a broken existing manifest before calling a model", async () => {
    fs.mkdirSync(path.dirname(installed));
    fs.writeFileSync(installed, "broken");
    expect(await generate()).toBe(1);
    expect(fs.existsSync(path.join(dir, "captured.jsonl"))).toBe(false);
  });
});
