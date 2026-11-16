/**
 * The committed suites and what they stored: every subject of the real truth
 * set is judged by some suite, each suite's stored results hold exactly the
 * verdicts it plans, and each stored score table is what `score` makes of its
 * results today. The suites were run live; this proves, with no model, that
 * what they left is whole and that the tables follow from it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { COMMANDS } from "../../../evaluation/commands.ts";
import type { ResolvedBinding } from "../../../evaluation/core/config.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { loadTruthSet, TRUTH_ROOT } from "../../../evaluation/lib/truth/loader.ts";
import type { TruthSet } from "../../../evaluation/lib/truth/loader.ts";
import { verdictKey } from "../../../evaluation/lib/truth/schemas.ts";
import type { StoredSubject } from "../../../evaluation/lib/truth/schemas.ts";
import { readSuiteFile, SUITES_DIR } from "../../../evaluation/suite/file.ts";
import type { SuiteFile } from "../../../evaluation/suite/file.ts";
import { planSuite } from "../../../evaluation/suite/plan.ts";
import type { SuitePlan } from "../../../evaluation/suite/plan.ts";

const ROOT = repoRoot();

/** A binding that is never called: planning reads only its name and model. */
function stub(name: string): ResolvedBinding {
  return { name, cmd: "true", command: "/usr/bin/true", args: [], extract_path: null, model: null, timeout_ms: 1000, retries: 0 };
}

let set: TruthSet;
let suites: Array<SuiteFile & { plan: SuitePlan }>;
beforeAll(async () => {
  set = await loadTruthSet(path.join(ROOT, TRUTH_ROOT));
  const dir = path.join(ROOT, SUITES_DIR);
  suites = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = readSuiteFile(path.join(dir, name));
      return { ...file, plan: planSuite(file.suite, set, stub) };
    });
});

function subjectKeys(plan: SuitePlan): string[] {
  return plan.subjects.map(({ subject }) => JSON.stringify(subject.stored));
}

describe("the committed suites", () => {
  it("each name the models of every binding they call, so what they judge on does not depend on a bindings file", () => {
    expect(suites.length).toBeGreaterThan(0);
    for (const { name, suite, plan } of suites) {
      expect(Object.keys(suite.models).sort(), name).toEqual(plan.bindings.map((binding) => binding.name).sort());
    }
  });

  it("together judge every base, planted blueprint, game, variant and narrated turn of the truth set", () => {
    const everything = planSuite(
      {
        subjects: { bases: "all", blueprint_plants: "all", games: "all", game_variants: "all" },
        judges: ["fairness", "gm_spoiler", "age_appropriate_turn"],
        models: {},
        samples: 1,
        concurrency: 1,
        thresholds: [],
      },
      set,
      stub,
    );
    const judged = new Set(suites.flatMap(({ plan }) => subjectKeys(plan)));
    const expected = subjectKeys(everything);
    const kinds = new Set(everything.subjects.map(({ subject }) => subject.kind));
    expect(kinds).toEqual(new Set(["blueprint", "game", "turn"]));
    expect(expected.filter((key) => !judged.has(key))).toEqual([]);

    // "all" is the whole truth set: every base and plant, every game and
    // variant, and narrated turns of each game and variant.
    const ids = (kind: string) => everything.subjects.filter(({ subject }) => subject.kind === kind).map(({ subject }) => subject.id).sort();
    expect(ids("blueprint")).toEqual([...set.bases.map(({ id }) => id), ...set.blueprintPlants.map(({ id }) => id)].sort());
    expect(ids("game")).toEqual([...set.games.map(({ id }) => id), ...set.turnVariants.map(({ id }) => id)].sort());
    const withTurns = new Set(everything.subjects.filter(({ subject }) => subject.kind === "turn").map(({ subject }) => subject.id.replace(/--s\d+$/, "")));
    expect([...withTurns].sort()).toEqual(ids("game"));
  });
});

describe("the stored results of the committed suites", () => {
  it("are, for each suite, results/<suite>.json holding exactly the verdicts it plans", () => {
    for (const { name, plan } of suites) {
      const stored = set.results.find((results) => results.id === name);
      expect(stored, `results/${name}.json`).toBeDefined();
      const planned = plan.subjects.flatMap(({ subject, calls }) =>
        calls.map((call) => verdictKey({ subject: subject.stored as StoredSubject, judge: call.judge.id, model: call.model, sample: call.sample })),
      );
      expect(stored!.verdicts.map(verdictKey).sort(), name).toEqual(planned.sort());
    }
  });

  it("are each scored by a stored score table", () => {
    const scored = new Set(
      set.scores.flatMap(({ file }) => (JSON.parse(fs.readFileSync(file, "utf8")) as { inputs: { results: string[] } }).inputs.results),
    );
    for (const { name } of suites) expect(scored, name).toContain(`${TRUTH_ROOT}/results/${name}.json`);
  });
});

describe("the stored score tables", () => {
  it("are each, byte for byte, what score writes from the results they name", async () => {
    expect(set.scores.length).toBeGreaterThan(0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-scores-"));
    try {
      for (const { id, file } of set.scores) {
        const stored = fs.readFileSync(file, "utf8");
        const { inputs } = JSON.parse(stored) as { inputs: { truth: string; results: string[] } };
        expect(inputs.truth, id).toBe(TRUTH_ROOT);
        const out = path.join(dir, `${id}.json`);
        const err: string[] = [];
        const code = await runEval(["score", ...inputs.results.map((file) => path.join(ROOT, file)), "--out", out], { root: ROOT, out: () => {}, err: (text) => err.push(text), env: {} }, COMMANDS);
        expect({ id, code, err: err.join("\n") }).toEqual({ id, code: 0, err: "" });
        expect(fs.readFileSync(out, "utf8") === stored, `${id}: regenerate it with ./dev eval score ${inputs.results.join(" ")} --out ${TRUTH_ROOT}/scores/${id}.json`).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
