import fs from "node:fs/promises";
import path from "node:path";

export function slugifyDraftName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "draft";
}

export function draftOutputName(value) {
  return slugifyDraftName(value);
}

export function generatedBlueprintFilename(outputName, index) {
  return `${draftOutputName(outputName)}.${index}.blueprint.json`;
}

export function generatedVerificationFilename(outputName, index) {
  return `${draftOutputName(outputName)}.${index}.verification.json`;
}

export function generatedAIJudgeReportFilename(outputName, index) {
  return `${draftOutputName(outputName)}.${index}.ai-judge-report.json`;
}

export function deriveArtifactPaths(blueprintPath) {
  const dir = path.dirname(blueprintPath);
  const basename = path.basename(blueprintPath);
  const generatedMatch = /^(.*)\.(\d+)\.blueprint\.json$/u.exec(basename);

  if (generatedMatch) {
    const outputName = generatedMatch[1];
    const index = Number(generatedMatch[2]);
    return {
      deterministicReportPath: path.join(dir, generatedVerificationFilename(outputName, index)),
      aiJudgeReportPath: path.join(dir, generatedAIJudgeReportFilename(outputName, index)),
    };
  }

  const base = basename.replace(/\.blueprint\.json$/u, "").replace(/\.json$/u, "");

  return {
    deterministicReportPath: path.join(dir, `${base}.deterministic-report.json`),
    aiJudgeReportPath: path.join(dir, `${base}.ai-judge-report.json`),
  };
}

export async function createDraftRun({
  briefPath,
  outputName,
  draftsRoot = path.join("blueprints", "drafts"),
}) {
  const brief = await fs.readFile(briefPath, "utf-8");
  const normalizedOutputName = draftOutputName(outputName);
  await fs.mkdir(draftsRoot, { recursive: true });

  return { brief, runDir: draftsRoot, outputName: normalizedOutputName };
}
