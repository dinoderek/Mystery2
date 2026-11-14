// The judge registry, its loader, prompt composer and output validator.
//
// What a judge is asked is pinned by the prompt snapshots; these tests pin
// that the registry is the one place those prompts are composed from, and that
// what it declares about each judge holds on disk.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkAnswerIds } from "../../../evaluation/core/judge-id-checks.ts";
import { loadAnalyzer, loadCheck, loadJudge, resolveRegistryPath } from "../../../evaluation/core/judge-loader.ts";
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
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

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

  it("registers the dimensions, the game-master judges, both age judges, flesch and the mechanical checks", () => {
    expect(judgesFor("blueprint").map((j) => j.id)).toEqual([
      "solve_depth",
      "fairness",
      "timeline_coherence",
      "knowledge_coherence",
      "character_grounding",
      "path_payoff",
      "clue_graph",
      "age_appropriate",
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
    expect(checksFor("blueprint")).toHaveLength(8);
    expect(checksFor("game").map((c) => c.id)).toEqual(["clue_accounting", "spoiler_leak", "clue_requires_violation"]);
    expect(checksFor("turn").map((c) => c.id)).toEqual(["flesch"]);
  });

  it("keeps the two verdict rules: dimensions take the stated verdict, game-master judges fail on a major finding", () => {
    for (const judge of judges) {
      expect(judge.verdict, judge.id).toBe(judge.id.startsWith("gm_") ? "major_findings" : "stated");
    }
  });

  it("looks entries up by id and refuses an unknown one, naming the known ids", () => {
    expect(findEntry("fairness")?.type).toBe("judge");
    expect(findEntry("nope")).toBeUndefined();
    expect(() => getEntry("nope")).toThrow(/Known: .*fairness/);
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

  it("loads an analyzer for exactly the judges whose entry names one", async () => {
    for (const judge of judges) {
      const analyzer = await loadAnalyzer(judge.id);
      if (judge.analyzer) expect(typeof analyzer?.analyze, judge.id).toBe("function");
      else expect(analyzer, judge.id).toBeNull();
    }
    expect(judges.filter((j) => j.analyzer).map((j) => j.id)).toEqual(["clue_graph", "age_appropriate"]);
  });

  it("loads the function behind every check", async () => {
    for (const check of REGISTRY.filter((e) => e.type === "check")) {
      expect(typeof (await loadCheck(check.id)), check.id).toBe("function");
    }
    await expect(loadCheck("fairness")).rejects.toThrow(/is a judge/);
  });

  it("names a file that is missing, and a schema that exports no `schema`", async () => {
    const base = judges.find((j) => j.id === "fairness") as JudgeEntry & { prompt: { kind: "files" } };
    await expect(
      loadJudge({ ...base, prompt: { ...base.prompt, brief: "evaluation/dimensions/no-such-brief.md" } }),
    ).rejects.toThrow(/ENOENT/);
    await expect(
      loadJudge({ ...base, prompt: { ...base.prompt, schema: "evaluation/judges/index.mjs" } }),
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
    const { schema } = await loadJudge("fairness");
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
  const blueprint = validBlueprintV2 as unknown as {
    solution_paths: Array<{ id: string }>;
    world: { characters: Array<{ id: string; first_name: string; is_culprit?: boolean }> };
  };
  const culprit = blueprint.world.characters.find((c) => c.is_culprit)!;
  const innocents = blueprint.world.characters.filter((c) => !c.is_culprit);

  async function answerFor(id: string, answer: unknown, context: Record<string, unknown> = {}) {
    return validateJudgeAnswer(await loadJudge(id), answer, blueprint, context);
  }

  const fairnessAnswer = (ids: string[]) => ({
    non_culprits: ids.map((id) => ({ character_id: id, ruled_out: true, ruling_evidence: null, reasoning: "r" })),
    verdict: "pass",
    reasoning: "r",
  });

  it("accepts an answer that cites only blueprint ids and covers every non-culprit", async () => {
    expect(await answerFor("fairness", fairnessAnswer(innocents.map((c) => c.id)))).toMatchObject({ ok: true });
  });

  it("reports the stage that rejects an answer: shape first, then ids", async () => {
    expect(await answerFor("fairness", {})).toMatchObject({ ok: false, stage: "shape" });
    expect(await answerFor("fairness", fairnessAnswer(["ghost"]))).toMatchObject({ ok: false, stage: "ids" });
    // A judge that declares no id checks passes on shape alone.
    expect(await answerFor("timeline_coherence", { issues: [], verdict: "pass", reasoning: "r" })).toMatchObject({
      ok: true,
    });
  });

  it("rejects an answer citing an unknown blueprint id", () => {
    const rules = getJudgeEntry("fairness").idChecks ?? [];
    const issues = checkAnswerIds(
      rules,
      { non_culprits: [...innocents.map((c) => ({ character_id: c.id })), { character_id: "ghost" }] },
      blueprint,
    );
    expect(issues).toEqual([expect.stringContaining('non_culprits[' + innocents.length + '].character_id "ghost" is not a non-culprit character id')]);
  });

  it("rejects the culprit named as a non-culprit, a repeat, and a missing character", () => {
    const rules = getJudgeEntry("fairness").idChecks ?? [];
    const [first] = innocents;
    const issues = checkAnswerIds(
      rules,
      { non_culprits: [{ character_id: culprit.id }, { character_id: first.id }, { character_id: first.id }] },
      blueprint,
    );
    expect(issues.some((i) => i.includes(`"${culprit.id}" is not a non-culprit`))).toBe(true);
    expect(issues.some((i) => i.includes(`"${first.id}" appears more than once`))).toBe(true);
    if (innocents.length > 1) {
      expect(issues.some((i) => i.includes(`missing an entry for non-culprit character id "${innocents[1].id}"`))).toBe(true);
    }
  });

  it("rejects a solve path that is not in the blueprint and a clue that does not exist", () => {
    const rules = getJudgeEntry("solve_depth").idChecks ?? [];
    const issues = checkAnswerIds(
      rules,
      {
        paths: [{ id: "path-x", necessary_clues: ["clue-x"] }],
        shortest_path_id: "path-y",
        elimination_paths: [],
        uncovered_suspects: [],
      },
      blueprint,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('paths[0].id "path-x" is not a blueprint solution path id'),
        expect.stringContaining('paths[0].necessary_clues[0] "clue-x" is not a blueprint clue id'),
        expect.stringContaining('shortest_path_id "path-y" is not a enumerated path id'),
      ]),
    );
    expect(issues.some((i) => i.startsWith("paths[].id is missing an entry for blueprint solution path id"))).toBe(
      blueprint.solution_paths.length > 0,
    );
  });

  it("lets an absent shortest path and an empty suspect pass", () => {
    const issues = checkAnswerIds(
      getJudgeEntry("solve_depth").idChecks ?? [],
      {
        paths: blueprint.solution_paths.map((p) => ({ id: p.id, necessary_clues: [] })),
        shortest_path_id: null,
        elimination_paths: [],
      },
      blueprint,
    ).filter((i) => !i.startsWith("elimination_paths[].id is missing"));
    expect(issues).toEqual([]);
  });

  it("checks a clue id cited by an issue, and a leak that names no clue", () => {
    const rules = getJudgeEntry("knowledge_coherence").idChecks ?? [];
    expect(checkAnswerIds(rules, { issues: [{ kind: "observability", clue_ids: ["clue-x"] }] }, blueprint)).toEqual([
      expect.stringContaining('issues[0].clue_ids[0] "clue-x" is not a blueprint clue id'),
    ]);
    expect(checkAnswerIds(rules, { issues: [{ kind: "pre_discovery_leak", clue_ids: [] }] }, blueprint)).toEqual([
      "issues[0] is a pre_discovery_leak but clue_ids is empty (name the clue it gives away)",
    ]);
  });

  it("checks that characters are real, named as the blueprint names them, and probed on the given topics", () => {
    const rules = getJudgeEntry("character_grounding").idChecks ?? [];
    const [first] = blueprint.world.characters;
    const issues = checkAnswerIds(
      rules,
      {
        characters: [
          { character_id: first.id, first_name: "Wrong", topics: [{ topic: "off topic" }] },
          { character_id: "ghost", first_name: "Boo", topics: [] },
        ],
      },
      blueprint,
      { probe_topics: ["their likes and dislikes"] },
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('characters[1].character_id "ghost" is not a blueprint character id'),
        expect.stringContaining(`characters[0].first_name for "${first.id}" is "Wrong" but the blueprint says "${first.first_name}"`),
        expect.stringContaining('"off topic" is not a context.probe_topics entry'),
      ]),
    );
    // With no topics in the context, topics are not checked.
    expect(
      checkAnswerIds(rules, { characters: [{ character_id: first.id, first_name: first.first_name, topics: [{ topic: "x" }] }] }, blueprint, {}).some(
        (i) => i.includes("probe_topics"),
      ),
    ).toBe(false);
  });

  it("checks the target age and that every finding names a player-facing path", () => {
    const rules = getJudgeEntry("age_appropriate").idChecks ?? [];
    const issues = checkAnswerIds(rules, { target_age: 99, findings: [{ path: "world.not.a.real.path" }] }, blueprint);
    expect(issues).toEqual([
      expect.stringContaining("target_age 99 does not match blueprint.metadata.target_age"),
      expect.stringContaining('findings[0].path "world.not.a.real.path" is not a player-facing string path'),
    ]);
  });
});
