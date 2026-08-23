#!/usr/bin/env node
// Pivot a runtime-eval run into an interaction x age table.
//
// A run writes one result.json per (case x backend); reading them one at a time
// tells you little. What you actually want to know is where the narrator drifts
// off its reading level — and that only shows up when the same nine
// interactions are compared across target ages.
//
// Reads a run directory (or the newest under evaluation/runtime/runs) and
// prints, per interaction and age: the judge verdicts, the Flesch–Kincaid grade
// against the grade implied by target_age, and the LLM judge's estimated
// reading age against the target.
//
// Usage:
//   node evaluation/runtime/report.mjs [run-dir] [--json]

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const RUNS_ROOT = path.join("evaluation", "runtime", "runs");

async function newestRunDir() {
  const entries = await fs.readdir(RUNS_ROOT, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (dirs.length === 0) throw new Error(`No runs found under ${RUNS_ROOT}`);
  return path.join(RUNS_ROOT, dirs[dirs.length - 1]);
}

/** Case ids are `<age-slug>-<interaction>` (see cases/all-interactions.mjs). */
export function splitCaseId(caseId) {
  const m = /^(age\d+)-(.+)$/.exec(caseId);
  return m ? { group: m[1], interaction: m[2] } : { group: "-", interaction: caseId };
}

export function collectRows(records) {
  return records.map((r) => {
    const { group, interaction } = splitCaseId(r.case_id);
    const flesch = r.judges.find((j) => j.id === "flesch");
    const age = r.judges.find((j) => j.id === "age_appropriate");
    return {
      group,
      interaction,
      backend: r.backend,
      model: r.model,
      target_age: flesch?.details?.target_age ?? age?.details?.target_age ?? null,
      flesch_status: flesch?.status ?? null,
      flesch_grade: typeof flesch?.score === "number" ? flesch.score : null,
      expected_grade: flesch?.details?.expected_grade ?? null,
      age_status: age?.status ?? null,
      estimated_reading_age: typeof age?.score === "number" ? age.score : null,
      findings: age?.details?.findings?.length ?? 0,
    };
  });
}

function fmt(v, width, pad = " ") {
  return String(v ?? "-").padEnd(width, pad);
}

function statusMark(status) {
  return status === "pass" ? "pass" : status === "fail" ? "FAIL" : status ? "err " : "-";
}

function renderTable(rows) {
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  const interactions = [...new Set(rows.map((r) => r.interaction))];

  const lines = [];
  for (const group of groups) {
    const inGroup = rows.filter((r) => r.group === group);
    const targetAge = inGroup.find((r) => r.target_age != null)?.target_age ?? "?";
    const models = [...new Set(inGroup.map((r) => `${r.backend}/${r.model}`))].join(", ");
    lines.push("");
    lines.push(`── target age ${targetAge}  (${models})`);
    lines.push(
      `   ${fmt("interaction", 20)} ${fmt("flesch", 6)} ${fmt("grade", 7)} ` +
        `${fmt("age judge", 10)} ${fmt("est.age", 8)} findings`,
    );
    for (const interaction of interactions) {
      const r = inGroup.find((x) => x.interaction === interaction);
      if (!r) continue;
      const grade = r.flesch_grade == null
        ? "-"
        : `${r.flesch_grade.toFixed(1)}${r.expected_grade != null ? `/${r.expected_grade}` : ""}`;
      const estAge = r.estimated_reading_age == null
        ? "-"
        : `${r.estimated_reading_age}${r.target_age != null ? `/${r.target_age}` : ""}`;
      lines.push(
        `   ${fmt(interaction, 20)} ${fmt(statusMark(r.flesch_status), 6)} ${fmt(grade, 7)} ` +
          `${fmt(statusMark(r.age_status), 10)} ${fmt(estAge, 8)} ${r.findings || ""}`,
      );
    }
  }

  // Which interactions fail, and at which ages — the actionable summary.
  const failing = rows.filter((r) => r.flesch_status === "fail" || r.age_status === "fail");
  lines.push("");
  if (failing.length === 0) {
    lines.push(`All ${rows.length} case(s) within their reading level.`);
  } else {
    lines.push(`${failing.length} of ${rows.length} case(s) above their reading level:`);
    for (const r of failing) {
      const why = [
        r.flesch_status === "fail" && r.flesch_grade != null
          ? `flesch ${r.flesch_grade.toFixed(1)} vs grade ${r.expected_grade}`
          : null,
        r.age_status === "fail" && r.estimated_reading_age != null
          ? `judge reads age ${r.estimated_reading_age} vs ${r.target_age}`
          : null,
      ].filter(Boolean).join("; ");
      lines.push(`   age ${r.target_age}  ${fmt(r.interaction, 20)} ${why}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const runDir = positional[0] ?? (await newestRunDir());

  const entries = await fs.readdir(runDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const resultPath = path.join(runDir, entry.name, "result.json");
    try {
      records.push(JSON.parse(await fs.readFile(resultPath, "utf-8")));
    } catch {
      // A case that errored before judging has no result.json; skip it rather
      // than failing the whole report.
    }
  }
  if (records.length === 0) {
    throw new Error(`No result.json files under ${runDir}`);
  }

  const rows = collectRows(records);
  if (asJson) {
    process.stdout.write(JSON.stringify({ run_dir: runDir, rows }, null, 2) + "\n");
    return;
  }
  console.log(`Runtime eval report — ${runDir}  (${rows.length} case(s))`);
  console.log(renderTable(rows));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[report] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
