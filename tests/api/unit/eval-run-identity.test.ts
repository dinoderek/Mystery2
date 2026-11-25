// Who ran what: `--suite` and `--label`, the developer and host, the parent run
// and the prompt versions a run records in its `run` block.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCommandArgs } from "../../../evaluation/core/args.ts";
import { READ_PATHS } from "../../../evaluation/core/baseline-status.ts";
import { configuredDeveloper, loadConfig } from "../../../evaluation/core/config.ts";
import { ConfigError, UsageError } from "../../../evaluation/core/errors.ts";
import {
  GENERATOR_PROMPT_FILES,
  NARRATOR_PROMPT_FILES,
  hashPromptFiles,
  promptVersions,
} from "../../../evaluation/core/prompt-versions.ts";
import { RunInfoSchema } from "../../../evaluation/core/result.ts";
import { createRunFolder } from "../../../evaluation/core/run-folder.ts";
import { osUserName, runIdentity } from "../../../evaluation/core/run-identity.ts";

const REPO_ROOT = path.resolve(__dirname, "../../..");

let scratch = "";

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "eval-run-identity-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeConfig(value: unknown): string {
  const file = path.join(scratch, "config.json");
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

describe("--suite and --label", () => {
  it("are read by every command, and null when absent", () => {
    const given = parseCommandArgs(["--suite", "narration-loop", "--label", "after the prompt change"]);
    expect(given.common).toMatchObject({ suite: "narration-loop", label: "after the prompt change" });
    expect(parseCommandArgs([]).common).toMatchObject({ suite: null, label: null });
    expect(parseCommandArgs(["a.json", "--suite", "s"], { positionals: { min: 1, max: 1 } }).positionals).toEqual(["a.json"]);
  });

  it("refuse a blank value, and no command may take them as its own", () => {
    expect(() => parseCommandArgs(["--suite", "  "])).toThrow(UsageError);
    expect(() => parseCommandArgs(["--label", ""])).toThrow(/--label needs a value/);
    expect(() => parseCommandArgs([], { options: { suite: { type: "string" } } })).toThrow(/common to every command/);
  });
});

describe("the developer", () => {
  it("is the config's top-level developer, which is not a binding", () => {
    const file = writeConfig({ developer: " dino ", "turn-judge": { cmd: "x", timeout_ms: 5 } });
    expect(configuredDeveloper({ root: scratch, configPath: file })).toBe("dino");
    expect(Object.keys(loadConfig({ root: scratch, configPath: file }).bindings)).toEqual(["turn-judge"]);
  });

  it("is the OS user name when the config names none, or there is no config file", () => {
    const none = writeConfig({ "turn-judge": { cmd: "x", timeout_ms: 5 } });
    expect(configuredDeveloper({ root: scratch, configPath: none })).toBeNull();
    expect(runIdentity({ suite: null, label: null, configPath: none }, scratch).developer).toBe(os.userInfo().username);
    const missing = path.join(scratch, "missing.json");
    expect(runIdentity({ suite: null, label: null, configPath: missing }, scratch).developer).toBe(osUserName());
  });

  it.each([
    ["an email address", "dino@example.com"],
    ["a blank name", " "],
    ["a non-string", 7],
  ])("refuses %s", (_label, developer) => {
    const file = writeConfig({ developer });
    expect(() => configuredDeveloper({ root: scratch, configPath: file })).toThrow(ConfigError);
    expect(() => loadConfig({ root: scratch, configPath: file })).not.toThrow();
  });

  it("is null in the committed example config, which leaves it to the OS user name", () => {
    const example = path.join(REPO_ROOT, "evaluation", "config.example.json");
    expect(JSON.parse(fs.readFileSync(example, "utf8"))).toHaveProperty("developer", null);
    expect(configuredDeveloper({ root: REPO_ROOT, configPath: example })).toBeNull();
  });
});

describe("the run folder", () => {
  it("records suite, label, developer, host, parent run and prompt versions in every result's run", () => {
    const common = { suite: "narration-loop", label: "after", configPath: writeConfig({ developer: "dino" }) };
    const folder = createRunFolder({
      outputRoot: scratch,
      command: "judge game",
      argv: [],
      root: REPO_ROOT,
      bindings: [],
      identity: runIdentity(common, REPO_ROOT, "2026-11-25/10-00-00-play"),
    });
    expect(folder.info()).toMatchObject({
      suite: "narration-loop",
      label: "after",
      developer: "dino",
      host: os.hostname(),
      parent_run: "2026-11-25/10-00-00-play",
      prompt_versions: promptVersions(),
    });
  });

  it("records nulls for an ad-hoc run with no parent, and the host and versions regardless", () => {
    const identity = runIdentity({ suite: null, label: null, configPath: writeConfig({}) }, REPO_ROOT);
    const info = createRunFolder({ outputRoot: scratch, command: "play", argv: [], root: REPO_ROOT, bindings: [], identity }).info();
    expect(info).toMatchObject({ suite: null, label: null, parent_run: null, host: os.hostname() });
    expect(info.developer).toBe(osUserName());
    expect(createRunFolder({ outputRoot: scratch, command: "validate", argv: [], root: REPO_ROOT, bindings: [] }).info().developer).toBeNull();
  });

  it("reads back a version 3 run written before these fields, with each of them null", () => {
    const { suite, label, developer, host, parent_run, prompt_versions, ...older } = createRunFolder({
      outputRoot: scratch,
      command: "validate",
      argv: [],
      root: REPO_ROOT,
      bindings: [],
    }).info();
    expect([suite, label, developer, parent_run].every((value) => value === null || typeof value === "string")).toBe(true);
    expect(host).toEqual(expect.any(String));
    expect(prompt_versions).not.toBeNull();
    expect(RunInfoSchema.parse(older)).toMatchObject({ suite: null, label: null, developer: null, host: null, parent_run: null, prompt_versions: null });
  });
});

describe("the prompt versions", () => {
  function copyOf(files: readonly string[]): string {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, file), path.join(scratch, file));
    }
    return scratch;
  }

  it("are 12 hex digits, one for the narrator and one for the generator", () => {
    expect(promptVersions()).toEqual({ narrator: expect.stringMatching(/^[0-9a-f]{12}$/), generator: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(promptVersions().narrator).not.toBe(promptVersions().generator);
  });

  it("change when a narrator prompt file changes, and not when an unrelated file does", () => {
    const root = copyOf([...NARRATOR_PROMPT_FILES, "packages/game-engine/src/turn/README.md"].filter((file) => fs.existsSync(path.join(REPO_ROOT, file))));
    const before = hashPromptFiles(root, NARRATOR_PROMPT_FILES);
    expect(hashPromptFiles(root, NARRATOR_PROMPT_FILES)).toBe(before);

    fs.writeFileSync(path.join(root, "packages/game-engine/src/accusations.ts"), "// not a prompt file\n");
    expect(hashPromptFiles(root, NARRATOR_PROMPT_FILES)).toBe(before);

    fs.appendFileSync(path.join(root, NARRATOR_PROMPT_FILES[0]), "\n// reworded\n");
    expect(hashPromptFiles(root, NARRATOR_PROMPT_FILES)).not.toBe(before);
  });

  it("change when a generator prompt file changes, and the narrator's do not", () => {
    const root = copyOf([...NARRATOR_PROMPT_FILES, ...GENERATOR_PROMPT_FILES]);
    const narrator = hashPromptFiles(root, NARRATOR_PROMPT_FILES);
    const generator = hashPromptFiles(root, GENERATOR_PROMPT_FILES);
    fs.appendFileSync(path.join(root, GENERATOR_PROMPT_FILES[0]), "\nAnother rule.\n");
    expect(hashPromptFiles(root, GENERATOR_PROMPT_FILES)).not.toBe(generator);
    expect(hashPromptFiles(root, NARRATOR_PROMPT_FILES)).toBe(narrator);
  });

  it("depend on the files' content, not on the order they are listed in", () => {
    const root = copyOf(NARRATOR_PROMPT_FILES);
    expect(hashPromptFiles(root, [...NARRATOR_PROMPT_FILES].reverse())).toBe(hashPromptFiles(root, NARRATOR_PROMPT_FILES));
  });

  it("refuse a file that is gone, rather than leave it out", () => {
    expect(() => hashPromptFiles(scratch, NARRATOR_PROMPT_FILES)).toThrow(/ENOENT/);
  });

  it("take the narrator's files from the paths `baseline status` treats as read, and every file exists", () => {
    const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n"));
    for (const file of [...NARRATOR_PROMPT_FILES, ...GENERATOR_PROMPT_FILES]) expect(tracked.has(file), `${file} is tracked`).toBe(true);
    for (const file of NARRATOR_PROMPT_FILES) {
      expect(READ_PATHS.some((read) => file === read || file.startsWith(`${read}/`)), `${file} is under a read path`).toBe(true);
    }
  });
});
