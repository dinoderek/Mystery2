// The judge registry, its loader, prompt composer and output validator.
//
// What a judge is asked is pinned by the prompt snapshots; these tests pin
// that the registry is the one place those prompts are composed from, and that
// what it declares about each judge holds on disk.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkAnswerIds } from "../../../evaluation/core/judge-id-checks.ts";
import { loadCheck, loadJudge, resolveRegistryPath } from "../../../evaluation/core/judge-loader.ts";
import { validateJudgeAnswer, validateJudgeOutput, validateTurnAgeAnswer } from "../../../evaluation/core/judge-output.ts";
import {
  composeJudgeSystemPrompt,
  composeJudgeUserMessage,
  composeTurnAgeSystemPrompt,
} from "../../../evaluation/core/judge-prompt.ts";
import {
  checksFor,
  findEntry,
  getEntry,
  getJudgeEntry,
  isSubjectKind,
  judgesFor,
  REGISTRY,
  SUBJECT_KINDS,
  VERDICT_RULES,
} from "../../../evaluation/core/registry.ts";
import type { JudgeEntry } from "../../../evaluation/core/registry.ts";
import { SNAPSHOT_ROOT } from "./eval-snapshot-store.ts";

const judges = REGISTRY.filter((e): e is JudgeEntry => e.type === "judge");

function stored(file: string): string {
  return fs.readFileSync(path.join(SNAPSHOT_ROOT, "prompts", file), "utf8");
}

describe("registry entries", () => {
  it("has a unique id for every check and judge", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry at least one subject kind, each a valid one", () => {
    for (const entry of REGISTRY) {
      expect(entry.subjects.length, entry.id).toBeGreaterThan(0);
      for (const subject of entry.subjects) expect(isSubjectKind(subject), `${entry.id}: ${subject}`).toBe(true);
    }
    expect(SUBJECT_KINDS).toEqual(["blueprint", "game", "turn"]);
  });

  it("gives every judge a verdict rule that exists", () => {
    for (const judge of judges) expect(VERDICT_RULES, judge.id).toContain(judge.verdict);
  });

  it("registers the case check and judges, the game-master judges, both age judges, flesch and the game checks", () => {
    expect(judgesFor("blueprint").map((j) => j.id)).toEqual([
      "cg_soundness",
      "cg_truth_agreement",
      "cg_character_grounding",
      "cg_step_sense",
    ]);
    expect(judgesFor("game").map((j) => j.id)).toEqual([
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
    ]);
    expect(judgesFor("turn").map((j) => j.id)).toEqual([
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
      "age_appropriate_turn",
    ]);
    expect(checksFor("blueprint").map((c) => c.id)).toEqual(["clue_graph_valid"]);
    expect(checksFor("game").map((c) => c.id)).toEqual(["clue_accounting", "spoiler_leak", "clue_requires_violation"]);
    expect(checksFor("turn").map((c) => c.id)).toEqual(["flesch"]);
    expect(REGISTRY.map((e) => e.id)).toEqual([
      "clue_graph_valid",
      "cg_soundness",
      "cg_truth_agreement",
      "cg_character_grounding",
      "cg_step_sense",
      "clue_accounting",
      "spoiler_leak",
      "clue_requires_violation",
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
      "flesch",
      "age_appropriate_turn",
      "gm_broad",
    ]);
  });

  it("keeps the two verdict rules: the turn age judge takes the stated verdict, every other judge fails on a major finding", () => {
    for (const judge of judges) {
      expect(judge.verdict, judge.id).toBe(judge.id === "age_appropriate_turn" ? "stated" : "major_findings");
    }
  });

  it("looks entries up by id and refuses an unknown one, naming the known ids", () => {
    expect(findEntry("cg_soundness")?.type).toBe("judge");
    expect(findEntry("nope")).toBeUndefined();
    expect(() => getEntry("nope")).toThrow(/Known: .*cg_soundness/);
    expect(() => getJudgeEntry("flesch")).toThrow(/is a check/);
  });
});

describe("loader", () => {
  it.each(judges.map((j) => j.id))("resolves the brief, schema and preamble of %s", async (id) => {
    const definition = await loadJudge(id);
    if (definition.entry.prompt.kind === "built") {
      expect(definition.schema).toBeNull();
      return;
    }
    expect(definition.text.length).toBeGreaterThan(0);
    expect(definition.preamble?.length).toBeGreaterThan(0);
    expect(typeof definition.schema?.safeParse).toBe("function");
    expect(definition.schema?.safeParse({}).success).toBe(false);
  });

  it("loads the function behind every check", async () => {
    for (const check of REGISTRY.filter((e) => e.type === "check")) {
      expect(typeof (await loadCheck(check.id)), check.id).toBe("function");
    }
    await expect(loadCheck("cg_soundness")).rejects.toThrow(/is a judge/);
  });

  it("names a file that is missing, and a schema that exports no `schema`", async () => {
    const base = judges.find((j) => j.id === "cg_soundness") as JudgeEntry & { prompt: { kind: "files" } };
    await expect(
      loadJudge({ ...base, prompt: { ...base.prompt, brief: "evaluation/dimensions/no-such-brief.md" } }),
    ).rejects.toThrow(/ENOENT/);
    await expect(
      loadJudge({ ...base, prompt: { ...base.prompt, schema: "evaluation/judges/index.ts" } }),
    ).rejects.toThrow(/must export a named 'schema'/);
  });

  it("reads a path that is relative to the repository root, or absolute", () => {
    expect(fs.existsSync(resolveRegistryPath("evaluation/core/registry.ts"))).toBe(true);
    expect(resolveRegistryPath("/somewhere/else.md")).toBe("/somewhere/else.md");
  });

  it("lists every brief file in the dimension and judge directories", () => {
    const registered = new Set(
      judges.flatMap((j) => (j.prompt.kind === "files" ? [path.basename(j.prompt.brief)] : [])),
    );
    for (const dir of ["evaluation/dimensions", "evaluation/judges"]) {
      const briefs = fs.readdirSync(resolveRegistryPath(dir)).filter((f) => f.endsWith(".md") && f !== "README.md");
      for (const brief of briefs) expect(registered, `${dir}/${brief} is in no registry entry`).toContain(brief);
    }
  });
});

describe("composer reproduces the prompt snapshots through the registry", () => {
  const filed = judges.filter((j) => j.prompt.kind === "files");
  const cases = filed.flatMap((judge) => {
    const prefixes = judge.subjects.map((s) => ({ blueprint: "blueprint", game: "trace", turn: "runtime" })[s]);
    return prefixes.map((prefix) => ({ id: judge.id, snapshot: `${prefix}.${judge.id}` }));
  });

  it.each(cases)("$snapshot: system prompt and user message", async ({ id, snapshot }) => {
    const definition = await loadJudge(id);
    const message = JSON.parse(stored(`${snapshot}.user.json`)) as Record<string, unknown>;
    const { dimension_id: dimensionId, context, ...parts } = message;

    expect(dimensionId).toBe(id);
    expect(context).toEqual(definition.entry.context ?? null);
    expect(composeJudgeSystemPrompt(definition, definition.entry.context ?? null)).toBe(
      stored(`${snapshot}.system.txt`),
    );
    expect(composeJudgeUserMessage(id, context as Record<string, unknown> | null, parts)).toBe(
      JSON.stringify(message),
    );
  });

  it("composes the turn-level age judge's prompt from the age profile", () => {
    const message = JSON.parse(stored("runtime.age_appropriate.user.json")) as { target_age: number };
    expect(composeTurnAgeSystemPrompt(message.target_age)).toBe(stored("runtime.age_appropriate.system.txt"));
  });

  it("refuses to compose a file prompt for a judge built in code", async () => {
    const built = await loadJudge("age_appropriate_turn");
    expect(() => composeJudgeSystemPrompt(built)).toThrow(/builds its prompt in code/);
  });
});

describe("output validator: shape", () => {
  it("rejects what is not an object, and an answer with no verdict when there is no schema", () => {
    expect(validateJudgeOutput(null, null).ok).toBe(false);
    expect(validateJudgeOutput({}, null)).toEqual({ ok: false, message: "Judge output missing verdict." });
    expect(validateJudgeOutput({ verdict: "pass" }, null).ok).toBe(true);
  });

  it("names the paths that miss the schema", async () => {
    const { schema } = await loadJudge("cg_soundness");
    const result = validateJudgeOutput({}, schema);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/schema validation/);
  });

  it("checks the turn-level age judge's answer in code", () => {
    const good = { estimated_reading_age: 8, findings: [], verdict: "pass", reasoning: "r" };
    expect(validateTurnAgeAnswer(good)).toBe(good);
    expect(() => validateTurnAgeAnswer({ ...good, verdict: "maybe" })).toThrow(/verdict/);
    expect(() => validateTurnAgeAnswer({ ...good, estimated_reading_age: 8.5 })).toThrow(/estimated_reading_age/);
    expect(() => validateTurnAgeAnswer({ ...good, findings: [{ quote: "q", why: "w", kind: "x" }] })).toThrow(/kind/);
    expect(() => validateTurnAgeAnswer([])).toThrow(/not a JSON object/);
  });
});

describe("output validator: the id checks a registry entry declares", () => {
  const greenhouse = JSON.parse(fs.readFileSync(path.join(process.cwd(), "blueprints", "clue-graph", "greenhouse-prizewinner.json"), "utf8")) as {
    clues: Record<string, unknown>;
    characters: Record<string, unknown>;
  };
  const characterIds = Object.keys(greenhouse.characters);
  const groundingAnswer = (ids: string[]) => ({ characters: ids.map((id) => ({ character_id: id })), findings: [] });

  it("reports the stage that rejects an answer: shape first, then ids", async () => {
    const definition = await loadJudge("cg_character_grounding");
    expect(validateJudgeAnswer(definition, {}, greenhouse)).toMatchObject({ ok: false, stage: "shape" });
    const answer = {
      verdict: "pass",
      reasoning: "r",
      characters: characterIds.map((id) => ({ character_id: id, fits: true, note: "n" })),
      findings: [],
    };
    expect(validateJudgeAnswer(definition, answer, greenhouse)).toMatchObject({ ok: true });
    expect(validateJudgeAnswer(definition, { ...answer, characters: [{ ...answer.characters[0], character_id: "ghost" }] }, greenhouse)).toMatchObject({ ok: false, stage: "ids" });
  });

  it("rejects an unknown character, a repeat and a missing one", () => {
    const rules = getJudgeEntry("cg_character_grounding").idChecks ?? [];
    const [first, second] = characterIds;
    const issues = checkAnswerIds(rules, groundingAnswer(["ghost", first, first]), greenhouse);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('characters[0].character_id "ghost" is not a case character id'),
        expect.stringContaining(`characters[2].character_id "${first}" appears more than once`),
        expect.stringContaining(`characters[].character_id is missing an entry for case character id "${second}"`),
      ]),
    );
  });

  it("lets a finding cite any clue, conclusion, character or location of the case, or the opening", () => {
    const rules = getJudgeEntry("cg_truth_agreement").idChecks ?? [];
    const clue = Object.keys(greenhouse.clues)[0];
    expect(checkAnswerIds(rules, { findings: [{ ids: [clue, characterIds[0], "opening"] }] }, greenhouse)).toEqual([]);
    expect(checkAnswerIds(rules, { findings: [{ ids: ["ghost"] }] }, greenhouse)).toEqual([
      expect.stringContaining('findings[0].ids[0] "ghost" is not a case clue, conclusion, character or location id, or opening'),
    ]);
  });
});
