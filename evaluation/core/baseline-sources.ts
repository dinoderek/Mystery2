import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { READ_PATHS } from "./baseline-status.ts";

export const BASELINE_EXTRA_PATHS = ["package.json", "package-lock.json", "scripts/lib/ai-seed.mjs", "scripts/local-config.mjs"];
export const BASELINE_SERVER_PATHS = [
  "evaluation/playtest/lib/api.ts", "lib/database-target.mjs", "scripts/lib/process.mjs", "scripts/lib/test-server.mjs",
  "tests/testkit/src/mock-case-scenes.json", "web/package.json", "web/src/routes/api", "web/src/lib/server",
];

function git(root: string, args: string[]): Buffer {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

export function baselineRevision(root: string, ref: string): string {
  return git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).toString().trim();
}

export interface BaselineSources {
  paths: readonly string[];
  has(file: string): boolean;
  children(directory: string): readonly string[];
  digest(file: string): string | null;
  text(file: string): string | null;
}

/** A stable filename for a checkout input. External inputs have no counterpart in a Git tree. */
export function baselinePath(root: string, file: string): string | null {
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function fileStat(absolute: string): fs.Stats | null {
  try {
    return fs.lstatSync(absolute);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}

function checkoutFile(root: string, file: string): Buffer | null {
  const absolute = path.join(root, file);
  return fileStat(absolute)?.isFile() ? fs.readFileSync(absolute) : null;
}

/** Read a working checkout using the same blob identities as the committed tree. */
export function checkoutSources(root: string, targets: readonly string[]): BaselineSources {
  const algorithm = git(root, ["rev-parse", "--show-object-format"]).toString().trim();
  const paths = git(root, ["--literal-pathspecs", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...READ_PATHS, ...BASELINE_EXTRA_PATHS, ...BASELINE_SERVER_PATHS, ...targets])
    .toString().split("\0").filter(Boolean);
  return {
    paths: [...new Set(paths)],
    has(file) {
      const stat = fileStat(path.join(root, file));
      return Boolean(stat?.isFile() || stat?.isSymbolicLink());
    },
    children(directory) {
      const absolute = path.join(root, directory);
      if (!fileStat(absolute)?.isDirectory()) return [];
      return fs.readdirSync(absolute, { withFileTypes: true })
        .filter((entry) => entry.isFile() || entry.isSymbolicLink())
        .map((entry) => path.posix.join(directory, entry.name));
    },
    digest(file) {
      const bytes = checkoutFile(root, file);
      return bytes === null ? null : createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    },
    text: (file) => checkoutFile(root, file)?.toString() ?? null,
  };
}

/** Read Git history without checking out code or resolving the run's source commit. */
export function revisionSources(root: string, revision: string): BaselineSources {
  const entries = new Map<string, string | null>();
  for (const line of git(root, ["ls-tree", "-rz", revision]).toString().split("\0")) {
    const match = /^(100[0-7]+|120000) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (match) entries.set(match[3], match[1] === "120000" ? null : match[2]);
  }
  const paths = [...entries.keys()];
  return {
    paths,
    has: (file) => entries.has(file),
    children: (directory) => paths.filter((file) => path.posix.dirname(file) === directory),
    digest: (file) => entries.get(file) ?? null,
    text(file) {
      const object = entries.get(file);
      return object == null ? null : git(root, ["cat-file", "blob", object]).toString();
    },
  };
}

/** Only history actually available locally can explain a difference in content. */
export function baselineCommits(root: string, from: string, to: string, files: string[]): string[] {
  if (files.length === 0) return [];
  const base = git(root, ["merge-base", from, to]).toString().trim();
  return git(root, ["--literal-pathspecs", "log", "--first-parent", "--format=%h %s", `${base}..${to}`, "--", ...files])
    .toString().trim().split("\n").filter(Boolean);
}
