/**
 * The suite's journal of finished calls: what lets a stopped suite resume
 * and never repeat a finished call.
 *
 * A call is keyed by its subject, judge, model, sample and the SHA-256 of its
 * prompt, so a changed brief or model is a new call and an unchanged one is
 * answered from the journal (`CallMemo` in `core/runner.ts`). A call stopped by
 * the usage limit never finishes, so it is never written and the next run
 * makes it.
 *
 * The journal is one JSON object per line, appended as each call finishes,
 * so a run killed mid-way loses at most the line it was writing: a torn last
 * line is cut off when the journal is opened. Any other line that does not
 * read is an error. It holds answers, never prompts.
 */

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { InputError } from "../core/errors.ts";
import { ModelCallSchema } from "../core/result.ts";
import type { CallMemo, FinishedCall } from "../core/runner.ts";
import { StoredSubjectSchema } from "../lib/truth/schemas.ts";
import type { StoredSubject } from "../lib/truth/schemas.ts";

export const JOURNAL_FILE = "calls.jsonl";

/** Which call of a suite this is, less its prompt. */
export interface CallIdentity {
  subject: StoredSubject;
  judge: string;
  model: string;
  sample: number;
}

const FinishedSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), answer: z.string(), call: ModelCallSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.string(), call: ModelCallSchema }).strict(),
]);

const LineSchema = z
  .object({
    subject: StoredSubjectSchema,
    judge: z.string().min(1),
    model: z.string().min(1),
    sample: z.number().int().nonnegative(),
    prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** The run folder that made the call, where its prompts and logs are. */
    run: z.string(),
    finished: FinishedSchema,
  })
  .strict();
type Line = z.infer<typeof LineSchema>;

function keyOf(identity: CallIdentity, promptSha256: string): string {
  return JSON.stringify([identity.subject, identity.judge, identity.model, identity.sample, promptSha256]);
}

/** The text up to its last newline: whatever follows was cut short. */
function wholeLines(text: string): string {
  return text.slice(0, text.lastIndexOf("\n") + 1);
}

export interface CallJournal {
  file: string;
  /** Calls the journal held when it was opened. */
  readonly held: number;
  /** Calls it holds now. */
  size(): number;
  /** A memo for one call: answers it from the journal, and appends it once it finishes. */
  memo(identity: CallIdentity): CallMemo & { readonly recalled: boolean };
}

/** Opens (or starts) the journal at `file`; calls made from now on are recorded as made by `runDir`. */
export function openJournal(file: string, runDir: string): CallJournal {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const kept = wholeLines(text);
  if (kept.length !== text.length) fs.truncateSync(file, Buffer.byteLength(kept));
  const calls = new Map<string, FinishedCall>();
  kept
    .split("\n")
    .filter((line) => line.trim() !== "")
    .forEach((line, index) => {
      let parsed: Line;
      try {
        parsed = LineSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new InputError(`${file}: line ${index + 1} is not a finished call: ${(error as Error).message.slice(0, 300)}`);
      }
      calls.set(keyOf(parsed, parsed.prompt_sha256), parsed.finished as FinishedCall);
    });
  return {
    file,
    held: calls.size,
    size: () => calls.size,
    memo(identity) {
      let recalled = false;
      return {
        get recalled() {
          return recalled;
        },
        recall(promptSha256) {
          const found = calls.get(keyOf(identity, promptSha256)) ?? null;
          recalled = found !== null;
          return found;
        },
        keep(promptSha256, finished) {
          // A kept answer that no longer parsed was made again: this call was not answered from the journal.
          recalled = false;
          calls.set(keyOf(identity, promptSha256), finished);
          const line: Line = { ...identity, prompt_sha256: promptSha256, run: runDir, finished };
          fs.appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
        },
      };
    },
  };
}
