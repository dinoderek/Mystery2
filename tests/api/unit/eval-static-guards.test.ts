import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { listCommands, runEval } from "../../../evaluation/core/dispatch.ts";

// What the evaluation tree is not allowed to contain again. These read the
// files rather than run them, so a regression fails here before it fails a
// run: a second copy of a runner, a model written into a wrapper, a script
// that reads a binding file for itself.

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const EVALUATION = path.join(ROOT, "evaluation");

function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.includes("node_modules"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const evaluationFiles = filesUnder(EVALUATION).map(relative);

/** The lines of a source file that are not whole-line comments. */
function codeLines(file: string): string[] {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*|#)/.test(line));
}

function filesMatching(files: string[], pattern: RegExp): string[] {
  return files.filter((file) => codeLines(file).some((line) => pattern.test(line)));
}

describe("the evaluation tree", () => {
  it("holds no .mjs file", () => {
    expect(evaluationFiles.filter((file) => file.endsWith(".mjs"))).toEqual([]);
  });

  it("writes no model into a wrapper script", () => {
    const wrappers = evaluationFiles.filter((file) => file.endsWith(".sh") && file.includes("wrappers/"));
    expect(wrappers.length).toBeGreaterThan(0);
    const modelName = /\b(opus|sonnet|haiku|fable)\b|\bgpt-\d|\bclaude-(opus|sonnet|haiku|fable)|EVAL_MODEL:-/i;
    expect(filesMatching(wrappers, modelName)).toEqual([]);
  });

  it("starts a model subprocess or calls a model API only in the core, or in a wrapper's own body", () => {
    const outsideCore = evaluationFiles.filter((file) => /\.(ts|sh)$/.test(file) && !file.startsWith("evaluation/core/"));
    // The api generation backend is a script a binding starts; it makes the one call.
    const wrapperBody = new Set(["evaluation/generate/openrouter.ts"]);
    // The self-play client talks to the throwaway game server, not to a model.
    const gameServerClient = new Set(["evaluation/playtest/lib/api.ts"]);
    const starter = /child_process|(?<![.\w])(spawn|spawnSync|execFile|execFileSync|execSync|exec)\(|runClaudeCli|generateBlueprint\(|openrouter\.ai|api\.openai\.com|(?<![.\w])fetch\(/;
    const offenders = filesMatching(outsideCore, starter).filter((file) => !wrapperBody.has(file) && !gameServerClient.has(file));
    expect(offenders).toEqual([]);
  });

  it("reads a binding file only through the core", () => {
    const outsideCore = evaluationFiles.filter((file) => file.endsWith(".ts") && !file.startsWith("evaluation/core/"));
    const bindingFile = /\bcli(\.example)?\.json\b|\bconfig(\.example)?\.json\b|\b(EXAMPLE_)?CONFIG_FILE\b/;
    expect(filesMatching(outsideCore, bindingFile)).toEqual([]);
  });
});

describe("./dev eval", () => {
  it("lists exactly the eight commands", () => {
    expect(COMMANDS.map((command) => command.name)).toEqual([
      "generate",
      "judge blueprint",
      "validate",
      "judge game",
      "judge turn",
      "cases",
      "play",
      "report",
    ]);
    const listing = listCommands(COMMANDS).split("\n");
    const listed = listing.filter((line) => /^ {2}\S/.test(line));
    expect(listed).toHaveLength(8);
  });

  it("has a test that runs each command's main path on stub bindings", () => {
    // The gate runs every command without a model call. A new command is a new
    // row here, naming the test that runs it and what that test starts it with.
    const runBy: Record<string, [file: string, startedWith: string]> = {
      generate: ["tests/api/unit/eval-generate-command.test.ts", '["generate", ...argv]'],
      "judge blueprint": ["tests/api/unit/eval-blueprint-command.test.ts", '["judge", "blueprint"'],
      validate: ["tests/api/unit/eval-blueprint-command.test.ts", '["validate"'],
      "judge game": ["tests/api/unit/trace-judge-game.test.ts", '["judge", "game"'],
      "judge turn": ["tests/api/unit/runtime-judge-turn.test.ts", '["judge", "turn"'],
      cases: ["tests/api/unit/no-turn-readers.test.ts", "casesCommand.run("],
      play: ["tests/api/integration/playtest-command.test.ts", "['play', ...args"],
      report: ["tests/api/integration/playtest-command.test.ts", "['report', runDir]"],
    };

    expect(Object.keys(runBy).sort()).toEqual(COMMANDS.map((command) => command.name).sort());
    for (const [name, [file, startedWith]] of Object.entries(runBy)) {
      expect(fs.readFileSync(path.join(ROOT, file), "utf8"), name).toContain(startedWith);
    }
  });

  it("prints that list for --help and exits 0", async () => {
    const out: string[] = [];
    const code = await runEval(["--help"], { root: ROOT, out: (text) => out.push(text), err: () => {}, env: {} }, COMMANDS);
    expect(code).toBe(0);
    expect(out.join("\n")).toBe(listCommands(COMMANDS));
  });
});

describe("the workspace validators", () => {
  function run(script: string, args: string[], cwd: string) {
    return spawnSync("node", [path.join(ROOT, script), ...args], { cwd, encoding: "utf8" });
  }

  it("reject a blueprint with missing fields without crashing, naming each one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-blueprint-"));
    try {
      fs.writeFileSync(path.join(dir, "b.json"), "{}");
      const result = run("evaluation/generator-harness/scripts/validate-blueprint.ts", ["b.json"], dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INVALID");
      expect(result.stderr).toContain("solution_paths");
      expect(result.stderr).not.toContain("fatal");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 3 with a usage line when given no file, and 2 for one that is not JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-blueprint-"));
    try {
      expect(run("evaluation/generator-harness/scripts/validate-blueprint.ts", [], dir).status).toBe(3);
      fs.writeFileSync(path.join(dir, "b.json"), "not json");
      expect(run("evaluation/generator-harness/scripts/validate-blueprint.ts", ["b.json"], dir).status).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("judge-output validator exits 3 with no file, and 2 outside a workspace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-judge-"));
    try {
      expect(run("evaluation/judge-harness/scripts/validate-judge-output.ts", [], dir).status).toBe(3);
      const result = run("evaluation/judge-harness/scripts/validate-judge-output.ts", ["verdict.json"], dir);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("dimension-id");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
