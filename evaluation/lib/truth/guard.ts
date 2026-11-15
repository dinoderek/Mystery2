/**
 * The truth set is public: it may hold no credential and no path into
 * someone's home folder. `findLeaks` reads every file under a folder and
 * reports each line that looks like either, naming the file. The gate runs it
 * over the truth set and its test fixture; anything that writes into the set
 * can run it too.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface Leak {
  file: string;
  line: number;
  /** What the line looks like, never the matched text itself. */
  what: string;
}

const PATTERNS: readonly { what: string; pattern: RegExp }[] = [
  { what: "an Anthropic API key", pattern: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { what: "an OpenRouter or OpenAI API key", pattern: /\bsk-(or-)?[A-Za-z0-9_-]{20,}/ },
  { what: "a GitHub token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { what: "an AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { what: "a Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { what: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { what: "a bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  {
    what: "an .env line setting a secret",
    pattern: /^\s*(export\s+)?[A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*\S/,
  },
  { what: "an absolute home path", pattern: /(^|[^A-Za-z0-9_.-])\/(Users|home)\/[^/\s"'`]+/ },
  { what: "an absolute home path", pattern: /\b[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s"'`]+/ },
];

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(file)));
    else found.push(file);
  }
  return found;
}

/** The lines of `text` that look like a credential or a home path. */
export function leaksIn(text: string, file: string): Leak[] {
  const leaks: Leak[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { what, pattern } of PATTERNS) {
      if (pattern.test(line)) leaks.push({ file, line: index + 1, what });
    }
  });
  return leaks;
}

/** Every leak in every file under `dir`, in file order. A missing folder has none. */
export async function findLeaks(dir: string): Promise<Leak[]> {
  const exists = await fs.stat(dir).then((stat) => stat.isDirectory(), () => false);
  if (!exists) return [];
  const leaks: Leak[] = [];
  for (const file of (await filesUnder(dir)).sort()) leaks.push(...leaksIn(await fs.readFile(file, "utf8"), file));
  return leaks;
}
