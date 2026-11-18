// Judge versions: the gate's hold on `evaluation/core/judge-versions.json`,
// and how a judge's hash follows what its registry entry names.

import { describe, expect, it } from "vitest";

import {
  checkJudgeVersions,
  JUDGE_VERSIONS_FILE,
  judgeHash,
  judgeVersion,
  judgeVersions,
  readJudgeVersionsFile,
} from "../../../evaluation/core/judge-version.ts";
import { getJudgeEntry, REGISTRY } from "../../../evaluation/core/registry.ts";
import type { JudgeEntry } from "../../../evaluation/core/registry.ts";

const JUDGES = REGISTRY.filter((entry): entry is JudgeEntry => entry.type === "judge");

describe("the judge versions file", () => {
  it("holds every judge at its latest version: a changed judge fails the gate until its new hash is appended", () => {
    expect(checkJudgeVersions()).toEqual([]);
  });

  it("gives every judge a version, the count of hashes it lists", () => {
    const recorded = readJudgeVersionsFile();
    for (const entry of JUDGES) expect(judgeVersion(entry.id), entry.id).toBe(recorded[entry.id].length);
    expect(Object.keys(judgeVersions()).sort()).toEqual(JUDGES.map((entry) => entry.id).sort());
    expect(() => judgeVersion("flesch")).toThrow('"flesch" is not a judge in the registry');
  });
});

describe("checking the versions file", () => {
  const fabrication = getJudgeEntry("gm_fabrication");
  const hash = judgeHash(fabrication);

  it("names the line to append for a judge changed since its latest version", () => {
    expect(checkJudgeVersions({ gm_fabrication: ["0000000000000000"] }, [fabrication])).toEqual([
      `gm_fabrication changed since version 1: append "${hash}" to its list in ${JUDGE_VERSIONS_FILE}, making version 2`,
    ]);
  });

  it("passes a judge whose files are its latest version, after earlier ones", () => {
    expect(checkJudgeVersions({ gm_fabrication: ["0000000000000000", hash] }, [fabrication])).toEqual([]);
  });

  it("names a judge with no version, a listed id that is no judge, and a version that repeats the one before", () => {
    expect(checkJudgeVersions({ gone: ["0000000000000000"] }, [fabrication])).toEqual([
      `${JUDGE_VERSIONS_FILE} lists "gone", which is not a judge in the registry`,
      `gm_fabrication has no version: add "gm_fabrication": ["${hash}"] to ${JUDGE_VERSIONS_FILE}`,
    ]);
    expect(checkJudgeVersions({ gm_fabrication: [hash, hash] }, [fabrication])).toEqual(["gm_fabrication: versions 1 and 2 have the same hash"]);
  });
});

describe("a judge's hash", () => {
  const fabrication = getJudgeEntry("gm_fabrication");

  it("is the same for the same entry, and changes with its brief, preamble, context, id checks or verdict rule", () => {
    const hash = judgeHash(fabrication);
    expect(judgeHash({ ...fabrication })).toBe(hash);
    if (fabrication.prompt.kind !== "files") throw new Error("gm_fabrication's prompt is in files");
    const changed: JudgeEntry[] = [
      { ...fabrication, prompt: { ...fabrication.prompt, brief: "evaluation/judges/gm-spoiler.md" } },
      { ...fabrication, prompt: { ...fabrication.prompt, preamble: "evaluation/prompts/judge-system.md" } },
      { ...fabrication, context: { strict: true } },
      { ...fabrication, idChecks: [{ kind: "equals", at: "target_age", to: "target_age" }] },
      { ...fabrication, verdict: "stated" },
    ];
    for (const entry of changed) expect(judgeHash(entry)).not.toBe(hash);
  });

  it("covers the file a built prompt is made in, and an analyzer", () => {
    const turnAge = getJudgeEntry("age_appropriate_turn");
    if (turnAge.prompt.kind !== "built") throw new Error("age_appropriate_turn's prompt is built");
    expect(judgeHash({ ...turnAge, prompt: { ...turnAge.prompt, source: "evaluation/core/judge-loader.ts" } })).not.toBe(judgeHash(turnAge));
    const graph = getJudgeEntry("clue_graph");
    expect(judgeHash({ ...graph, analyzer: { module: "evaluation/checks/analyzers/age-appropriate.ts", export: "analyze" } })).not.toBe(judgeHash(graph));
  });
});
