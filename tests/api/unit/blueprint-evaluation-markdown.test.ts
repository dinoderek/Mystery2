import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBlueprintEvaluationMarkdownDocument,
  parseBuildBlueprintEvaluationMarkdownArgs,
  runBuildBlueprintEvaluationMarkdownCli,
} from "../../../scripts/build-blueprint-evaluation-markdown.mjs";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

const validStoryBrief = {
  brief: "A child-friendly mystery about a missing tray of cookies.",
  targetAge: 8,
  timeBudget: 10,
  mustInclude: ["One innocent suspect with a believable motive"],
};

const validBlueprint = validBlueprintV2;

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
    expect(result.outputText).toContain("## Blueprint V2 Schema Reference");
    expect(written).toBe(result.outputText);
    expect(written).toContain("\"mustInclude\"");
    expect(written).toContain("\"schema_version\": \"v2\"");
    expect(written).toContain("\"ground_truth\"");
  });
});
