// A run's suite attributes: the content hash inputs are compared by, how a
// command's attributes are normalized, and how the run folder records them.
// Each run command's own attributes are tested beside the command.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunInfoSchema } from "../../../evaluation/core/result.ts";
import { createRunFolder } from "../../../evaluation/core/run-folder.ts";
import {
  bindingLabel,
  canonicalJson,
  contentHash,
  serverNarratorLabel,
  suiteAttributes,
} from "../../../evaluation/core/suite-attributes.ts";
import type { CommandAttributes } from "../../../evaluation/core/suite-attributes.ts";

const REPO_ROOT = path.resolve(__dirname, "../../..");

let scratch = "";

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "eval-suite-attributes-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const ATTRIBUTES: CommandAttributes = {
  options: { repair: 2 },
  inputs: [
    { id: "lighthouse", hash: contentHash({ brief: "b" }) },
    { id: "fete", hash: contentHash({ brief: "a" }) },
  ],
  judges: ["cg_step_sense", "cg_soundness", "cg_step_sense"],
  models: { generator: ["generator-agent:opus", "generator-agent:haiku", "generator-agent:opus"], judge: [] },
  samples: null,
  concurrency: 2,
};

describe("an input's content hash", () => {
  it("is 12 hex digits that ignore key order and layout, and change with the content", () => {
    const hash = contentHash({ a: 1, b: { c: [1, 2], d: "x" } });
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(contentHash({ b: { d: "x", c: [1, 2] }, a: 1 })).toBe(hash);
    expect(contentHash(JSON.parse(JSON.stringify({ a: 1, b: { c: [1, 2], d: "x" } }, null, 4)))).toBe(hash);
    expect(contentHash({ a: 1, b: { c: [2, 1], d: "x" } })).not.toBe(hash);
    expect(contentHash({ a: 1, b: { c: [1, 2], d: "y" } })).not.toBe(hash);
  });

  it("is taken over JSON with every object's keys sorted", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }], skipped: undefined })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});

describe("a model's label", () => {
  it("names a binding and its model, or the binding alone when it names none", () => {
    expect(bindingLabel({ name: "turn-judge", model: "haiku" })).toBe("turn-judge:haiku");
    expect(bindingLabel({ name: "judge-stub", model: null })).toBe("judge-stub");
  });

  it("names a server narrator by backend and model, or by the name the server resolves itself", () => {
    expect(serverNarratorLabel("measured", { backend: "openrouter", model: "test-model" })).toBe("server:openrouter:test-model");
    expect(serverNarratorLabel("mock", undefined)).toBe("server:mock");
    expect(serverNarratorLabel("default", undefined)).toBe("server:default");
  });
});

describe("a run's attributes", () => {
  it("hold every attribute, lists sorted and repeated labels once, a role without models null", () => {
    expect(suiteAttributes("generate", "blueprint-loop", ATTRIBUTES)).toEqual({
      command: "generate",
      options: { repair: 2 },
      inputs: [
        { id: "fete", hash: contentHash({ brief: "a" }) },
        { id: "lighthouse", hash: contentHash({ brief: "b" }) },
      ],
      judges: ["cg_soundness", "cg_step_sense"],
      models: { generator: ["generator-agent:haiku", "generator-agent:opus"], narrator: null, investigator: null, judge: null },
      samples: null,
      concurrency: 2,
      suite: "blueprint-loop",
    });
  });

  it("are the same whatever order a command lists them in", () => {
    const reordered = { ...ATTRIBUTES, inputs: [...ATTRIBUTES.inputs].reverse(), judges: [...ATTRIBUTES.judges].reverse() };
    expect(suiteAttributes("generate", null, reordered)).toEqual(suiteAttributes("generate", null, ATTRIBUTES));
  });

  it("are recorded by the run folder with its command and suite, and null for a command that is not a run command", () => {
    const identity = { suite: "blueprint-loop", label: "first", developer: "dino", parent_run: null };
    const info = createRunFolder({ outputRoot: scratch, command: "generate", argv: [], root: REPO_ROOT, bindings: [], identity, attributes: ATTRIBUTES }).info();
    expect(info.attributes).toEqual(suiteAttributes("generate", "blueprint-loop", ATTRIBUTES));
    expect(RunInfoSchema.parse(info).attributes).toEqual(info.attributes);

    const validate = createRunFolder({ outputRoot: scratch, command: "validate", argv: [], root: REPO_ROOT, bindings: [] }).info();
    expect(validate.attributes).toBeNull();
  });

  it("read back as null from a version 3 run written before they were recorded", () => {
    const { attributes, ...older } = createRunFolder({
      outputRoot: scratch,
      command: "generate",
      argv: [],
      root: REPO_ROOT,
      bindings: [],
      attributes: ATTRIBUTES,
    }).info();
    expect(attributes).not.toBeNull();
    expect(RunInfoSchema.parse(older).attributes).toBeNull();
  });

  it("refuse an attribute left out or one not in the table", () => {
    const recorded = suiteAttributes("generate", null, ATTRIBUTES);
    const missing: Partial<typeof recorded> = { ...recorded };
    delete missing.samples;
    const base = createRunFolder({ outputRoot: scratch, command: "generate", argv: [], root: REPO_ROOT, bindings: [] }).info();
    expect(() => RunInfoSchema.parse({ ...base, attributes: missing })).toThrow();
    expect(() => RunInfoSchema.parse({ ...base, attributes: { ...recorded, commit: "abc" } })).toThrow();
  });
});
