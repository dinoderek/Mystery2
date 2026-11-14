import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EXAMPLE_CONFIG_FILE,
  findCommand,
  loadConfig,
  parseModelOverrides,
  resolveBinding,
} from "../../../evaluation/core/config.ts";
import { ConfigError, UsageError } from "../../../evaluation/core/errors.ts";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** A throwaway repo root holding only what a test writes. */
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "eval-core-config-"));
  fs.mkdirSync(path.join(root, "evaluation", "wrappers"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function wrapper(name: string, mode = 0o755): string {
  const file = path.join(root, "evaluation", "wrappers", name);
  fs.writeFileSync(file, "#!/bin/sh\n");
  fs.chmodSync(file, mode);
  return `evaluation/wrappers/${name}`;
}

const bindingFor = (cmd: string, extra: Record<string, unknown> = {}) => ({
  cmd,
  args: ["{{user_message_file}}"],
  extract_path: null,
  model: "sonnet",
  timeout_ms: 1000,
  retries: 1,
  ...extra,
});

describe("the committed example config", () => {
  const example = loadConfig({ root: REPO_ROOT, configPath: path.join(REPO_ROOT, EXAMPLE_CONFIG_FILE) });

  it("names every binding, with the models in use", () => {
    const models = Object.fromEntries(Object.entries(example.bindings).map(([name, b]) => [name, b.model]));
    expect(models).toEqual({
      "generator-agent": "opus",
      "generator-api": null,
      "blueprint-judge": "opus",
      "game-judge": "opus",
      "turn-judge": "sonnet",
      investigator: "sonnet",
      "narrator-claude": "sonnet",
      "narrator-openai": "gpt-4o-mini",
      "narrator-stub": null,
      "judge-stub": null,
    });
  });

  it("points the bindings that have a wrapper today at a wrapper that runs", () => {
    for (const name of ["generator-agent", "blueprint-judge", "game-judge", "turn-judge", "narrator-claude", "narrator-stub", "judge-stub"]) {
      expect(resolveBinding(example, name, { root: REPO_ROOT }).command).toBe(
        path.join(REPO_ROOT, example.bindings[name].cmd),
      );
    }
  });
});

describe("loadConfig", () => {
  it("falls back to the example when there is no evaluation/config.json", () => {
    const example = writeJson(path.join(root, EXAMPLE_CONFIG_FILE), { "judge-stub": bindingFor("x") });
    expect(loadConfig({ root }).file).toBe(example);
  });

  it("prefers evaluation/config.json over the example", () => {
    writeJson(path.join(root, EXAMPLE_CONFIG_FILE), { "judge-stub": bindingFor("x") });
    const own = writeJson(path.join(root, "evaluation", "config.json"), { "turn-judge": bindingFor("y") });
    const config = loadConfig({ root });
    expect(config.file).toBe(own);
    expect(Object.keys(config.bindings)).toEqual(["turn-judge"]);
  });

  it("reads --config instead of either", () => {
    writeJson(path.join(root, "evaluation", "config.json"), { "turn-judge": bindingFor("y") });
    const chosen = writeJson(path.join(root, "elsewhere.json"), { "judge-stub": bindingFor("z") });
    expect(loadConfig({ root, configPath: chosen }).bindings["judge-stub"].cmd).toBe("z");
  });

  it("skips comment keys and fills the defaults", () => {
    const file = writeJson(path.join(root, "c.json"), {
      _comment: "ignored",
      "turn-judge": { cmd: "x", timeout_ms: 5 },
    });
    expect(loadConfig({ root, configPath: file }).bindings).toEqual({
      "turn-judge": { cmd: "x", args: [], extract_path: null, model: null, timeout_ms: 5, retries: 0 },
    });
  });

  it.each([
    ["a missing file", null, /cannot read config/],
    ["a file that is not JSON", "{", /is not JSON/],
    ["an array", "[]", /expected an object/],
    ["a bad binding name", JSON.stringify({ Turn_Judge: bindingFor("x") }), /binding name "Turn_Judge"/],
    ["a binding without a timeout", JSON.stringify({ a: { cmd: "x" } }), /binding "a" is invalid: timeout_ms/],
    ["an unknown field", JSON.stringify({ a: bindingFor("x", { modle: "opus" }) }), /Unrecognized key/],
  ])("refuses %s", (_label, text, message) => {
    const file = path.join(root, "bad.json");
    if (text !== null) fs.writeFileSync(file, text);
    expect(() => loadConfig({ root, configPath: file })).toThrow(ConfigError);
    expect(() => loadConfig({ root, configPath: file })).toThrow(message);
  });

  it("overrides one binding's model for this run, leaving the others", () => {
    const file = writeJson(path.join(root, "c.json"), { a: bindingFor("x"), b: bindingFor("y") });
    const config = loadConfig({ root, configPath: file, modelOverrides: { a: "opus" } });
    expect(config.bindings.a.model).toBe("opus");
    expect(config.bindings.b.model).toBe("sonnet");
  });

  it("refuses a model override for a binding the config does not have", () => {
    const file = writeJson(path.join(root, "c.json"), { a: bindingFor("x") });
    expect(() => loadConfig({ root, configPath: file, modelOverrides: { nope: "opus" } })).toThrow(
      /has no binding "nope". Bindings: a/,
    );
  });
});

describe("resolveBinding", () => {
  it("resolves a repo-relative command to its absolute path", () => {
    const file = writeJson(path.join(root, "c.json"), { a: bindingFor(wrapper("ok.sh")) });
    const binding = resolveBinding(loadConfig({ root, configPath: file }), "a", { root });
    expect(binding).toMatchObject({ name: "a", command: path.join(root, "evaluation/wrappers/ok.sh"), model: "sonnet" });
  });

  it("finds a bare command on PATH", () => {
    wrapper("on-path");
    const file = writeJson(path.join(root, "c.json"), { a: bindingFor("on-path") });
    const envPath = ["", path.join(root, "nowhere"), path.join(root, "evaluation", "wrappers")].join(path.delimiter);
    expect(resolveBinding(loadConfig({ root, configPath: file }), "a", { root, envPath }).command).toBe(
      path.join(root, "evaluation/wrappers/on-path"),
    );
  });

  it("is an error for a binding the config does not name", () => {
    const file = writeJson(path.join(root, "c.json"), { a: bindingFor("x") });
    expect(() => resolveBinding(loadConfig({ root, configPath: file }), "b", { root })).toThrow(
      /has no binding "b". Bindings: a/,
    );
  });

  it.each([
    ["absent", "evaluation/wrappers/missing.sh"],
    ["not executable", "not-executable"],
    ["a directory", "evaluation/wrappers"],
    ["not on PATH", "no-such-command-anywhere"],
  ])("is an error when the command is %s", (_label, cmd) => {
    const real = cmd === "not-executable" ? wrapper("plain.sh", 0o644) : cmd;
    const file = writeJson(path.join(root, "c.json"), { a: bindingFor(real) });
    expect(() => resolveBinding(loadConfig({ root, configPath: file }), "a", { root, envPath: "" })).toThrow(
      /binding "a" .* cannot run: command .* not found or not executable/,
    );
  });

  it("finds nothing for an empty PATH", () => {
    expect(findCommand("sh", root, "")).toBeNull();
  });
});

describe("parseModelOverrides", () => {
  it("reads binding=model pairs", () => {
    expect(parseModelOverrides(["turn-judge=opus", " a = b=c "])).toEqual({ "turn-judge": "opus", a: "b=c" });
  });

  it("refuses a value without a binding and a model", () => {
    expect(() => parseModelOverrides(["opus"])).toThrow(UsageError);
    expect(() => parseModelOverrides(["a="])).toThrow(/needs <binding>=<model>/);
  });
});
