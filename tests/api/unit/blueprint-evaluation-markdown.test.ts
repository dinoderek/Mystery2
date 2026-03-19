import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBlueprintEvaluationMarkdownDocument,
  parseBuildBlueprintEvaluationMarkdownArgs,
  runBuildBlueprintEvaluationMarkdownCli,
} from "../../../scripts/build-blueprint-evaluation-markdown.mjs";

const validStoryBrief = {
  brief: "A child-friendly mystery about a missing tray of cookies.",
  targetAge: 8,
  timeBudget: 10,
  mustInclude: ["One innocent suspect with a believable motive"],
};

const validBlueprint = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "The Missing Cookies",
    one_liner: "Someone took the cookies before snack time.",
    target_age: 8,
    time_budget: 12,
  },
  narrative: {
    premise: "The cookie plate is empty and snack time is almost here.",
    starting_knowledge: ["The cookies disappeared from the kitchen."],
  },
  world: {
    starting_location_id: "Kitchen",
    locations: [
      {
        name: "Kitchen",
        description: "A bright kitchen with crumbs on the counter.",
        clues: ["Cookie crumbs lead toward the hallway."],
      },
    ],
    characters: [
      {
        first_name: "Alice",
        last_name: "Smith",
        location: "Kitchen",
        sex: "female",
        appearance: "Red hair and a floury apron.",
        background: "Alice helped bake the snacks.",
        personality: "Nervous but kind.",
        initial_attitude_towards_investigator: "Guarded but polite.",
        location_id: "Kitchen",
        mystery_action_real: "She hid the cookies in her lunch bag.",
        stated_alibi: "I was washing bowls by the sink.",
        motive: "She was hungry after skipping breakfast.",
        is_culprit: true,
        knowledge: ["I saw crumbs near the hallway door."],
      },
    ],
  },
  ground_truth: {
    what_happened: "Alice took the cookies and hid them in her lunch bag.",
    why_it_happened: "She was hungry after skipping breakfast.",
    timeline: [
      "10:00 AM - The cookies are placed on the counter.",
      "10:05 AM - Alice pockets the cookies while no one is looking.",
    ],
  },
};

describe("parseBuildBlueprintEvaluationMarkdownArgs", () => {
  it("parses supported options", () => {
    expect(
      parseBuildBlueprintEvaluationMarkdownArgs([
        "--brief-file",
        "brief.json",
        "--blueprint-file",
        "blueprint.json",
        "--output",
        "packet.md",
        "--title",
        "Custom Packet",
      ]),
    ).toEqual({
      briefFile: "brief.json",
      blueprintFile: "blueprint.json",
      output: "packet.md",
      title: "Custom Packet",
    });
  });

  it("rejects missing required inputs", () => {
    expect(() =>
      parseBuildBlueprintEvaluationMarkdownArgs([
        "--brief-file",
        "brief.json",
      ]),
    ).toThrow("Missing required --blueprint-file");
  });
});

describe("buildBlueprintEvaluationMarkdownDocument", () => {
  it("assembles a self-contained markdown packet", () => {
    const markdown = buildBlueprintEvaluationMarkdownDocument({
      title: "Blueprint Evaluation Packet",
      storyBrief: validStoryBrief,
      blueprint: validBlueprint,
      prompt: "Prompt body",
      evaluationSchemaSource: "export const Schema = z.object({});",
      storyBriefSchemaSource: "export const StoryBriefSchema = z.object({});",
      blueprintSchemaSource: "export const BlueprintSchema = z.object({});",
    });

    expect(markdown).toContain("# Blueprint Evaluation Packet");
    expect(markdown).toContain("## Evaluator Prompt");
    expect(markdown).toContain("## Output Schema (Zod Source)");
    expect(markdown).toContain("## Story Brief JSON");
    expect(markdown).toContain("## Blueprint JSON");
    expect(markdown).toContain("\"brief\": \"A child-friendly mystery about a missing tray of cookies.\"");
    expect(markdown).toContain("\"title\": \"The Missing Cookies\"");
  });
});

describe("runBuildBlueprintEvaluationMarkdownCli", () => {
  it("loads inputs, validates them, and writes markdown output", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "evaluation-markdown-"));
    const briefFile = path.join(tempDir, "brief.json");
    const blueprintFile = path.join(tempDir, "blueprint.json");
    const outputFile = path.join(tempDir, "packet.md");

    await writeFile(briefFile, JSON.stringify(validStoryBrief), "utf-8");
    await writeFile(blueprintFile, JSON.stringify(validBlueprint), "utf-8");

    const result = await runBuildBlueprintEvaluationMarkdownCli({
      briefFile,
      blueprintFile,
      output: outputFile,
      title: "Cookie Packet",
    });

    const written = await readFile(outputFile, "utf-8");

    expect(result.outputText).toContain("# Cookie Packet");
    expect(result.outputText).toContain("## Blueprint Schema Reference");
    expect(written).toBe(result.outputText);
    expect(written).toContain("\"mustInclude\"");
    expect(written).toContain("\"ground_truth\"");
  });
});
