import fs from "node:fs/promises";
import path from "node:path";

export function slugifyDraftName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "draft";
}

export function createRunId(now = new Date()) {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

export function candidateBlueprintFilename(index) {
  return `candidate-${String(index).padStart(2, "0")}.blueprint.json`;
}

export function candidateRawOutputFilename(index) {
  return `candidate-${String(index).padStart(2, "0")}.raw-model-output.txt`;
}

export function candidateDeterministicReportFilename(index) {
  return `candidate-${String(index).padStart(2, "0")}.deterministic-report.json`;
}

export function candidateAIJudgeReportFilename(index) {
  return `candidate-${String(index).padStart(2, "0")}.ai-judge-report.json`;
}

export function deriveArtifactPaths(blueprintPath) {
  const dir = path.dirname(blueprintPath);
  const base = path.basename(blueprintPath).replace(/\.blueprint\.json$/u, "").replace(/\.json$/u, "");
  const candidateMatch = /^candidate-(\d{2})$/u.exec(base);

  if (candidateMatch) {
    const index = Number(candidateMatch[1]);
    return {
      deterministicReportPath: path.join(dir, candidateDeterministicReportFilename(index)),
      aiJudgeReportPath: path.join(dir, candidateAIJudgeReportFilename(index)),
    };
  }

  return {
    deterministicReportPath: path.join(dir, `${base}.deterministic-report.json`),
    aiJudgeReportPath: path.join(dir, `${base}.ai-judge-report.json`),
  };
}

export async function createDraftRun({
  briefPath,
  draftsRoot = path.join("blueprints", "drafts"),
  slug,
  now = new Date(),
}) {
  const brief = await fs.readFile(briefPath, "utf-8");
  const runId = createRunId(now);
  const draftSlug = slugifyDraftName(slug ?? path.basename(path.dirname(briefPath) || briefPath, path.extname(briefPath)));
  const slugDir = path.join(draftsRoot, draftSlug);
  const runDir = path.join(slugDir, runId);

  await fs.mkdir(slugDir, { recursive: true });
  await fs.mkdir(runDir, { recursive: false });
  await fs.writeFile(path.join(runDir, "brief.md"), brief, "utf-8");

  return { brief, draftSlug, runId, runDir };
}
