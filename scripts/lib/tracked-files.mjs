/**
 * The tracked-files check: no file named `ai.json` is tracked, at any depth.
 * It may hold OpenRouter keys in clear, and the repository is public.
 * `.gitignore` ignores it; this catches a `git add -f` and a rule removed.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

const FORBIDDEN_NAMES = ["ai.json"];

/** Every path git tracks, staged or committed. */
export function listTrackedFiles(repoRoot) {
  return execFileSync("git", ["ls-files", "--cached"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
}

/** The paths in `files` whose name must never be tracked. */
export function findForbiddenFiles(files) {
  return files.filter((file) => FORBIDDEN_NAMES.includes(path.posix.basename(file)));
}

/** Failure text for the gate log, or null when nothing forbidden is tracked. */
export function describeForbidden(found) {
  if (found.length === 0) return null;
  return [
    `${found.length} tracked file${found.length === 1 ? "" : "s"} that may hold keys:`,
    ...found.map((file) => `  ${file}`),
    "Untrack each with `git rm --cached <path>`; ai.example.json is the committed template.",
  ].join("\n");
}
