/**
 * Where run folders are under an output root: `<yyyy-mm-dd>/<run>`. Both
 * `perf push` and `perf sync` list them, and neither writes in them.
 */

import fs from "node:fs";
import path from "node:path";

/** The run folders under `outputRoot` (`<date>/<time>-<command>`), oldest first. */
export function runFolders(outputRoot: string): string[] {
  if (!fs.existsSync(outputRoot)) return [];
  const folders: string[] = [];
  for (const day of fs.readdirSync(outputRoot).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const dayDir = path.join(outputRoot, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const run of fs.readdirSync(dayDir).sort()) {
      if (fs.statSync(path.join(dayDir, run)).isDirectory()) folders.push(path.join(dayDir, run));
    }
  }
  return folders;
}

/** A path for a message: relative to `root` when it is under it, else as given. */
export function relativeTo(root: string, target: string): string {
  const relative = path.relative(root, target);
  return relative.startsWith("..") ? target : relative;
}
