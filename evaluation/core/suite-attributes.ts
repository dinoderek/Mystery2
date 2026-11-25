/**
 * A run's suite attributes: what was held fixed, so that two runs can be
 * compared. Every run command records them in full in `run.attributes`, whether
 * or not it ran a named suite, and nothing reduces them to a key: which ones must
 * match is chosen when the runs are read.
 *
 * | Attribute     | Holds |
 * | ------------- | ----- |
 * | `command`     | The command, as typed after `./dev eval` |
 * | `options`     | The command's options that change what runs, by name, with their effective values: `generate`'s `repair`, `play`'s `persona` and `max_steps` |
 * | `inputs`      | Each brief, case (with its blueprint file), stored turn (alone: its blueprint path may not exist elsewhere), trace or replay script: its id and a hash of its content as stored (`contentHash`), sorted by id |
 * | `judges`      | The ids of the judges and checks the run selected, sorted; versions are recorded apart |
 * | `models`      | One entry per role (`generator`, `narrator`, `investigator`, `judge`): the sorted labels the role ran on (`bindingLabel`, `serverNarratorLabel`), null when the run has no such role |
 * | `samples`     | How many times each input is run: `judge turn`'s `--samples` when a case has `expect`, `play`'s `--games`; null otherwise |
 * | `concurrency` | How many subjects run at once, null when the command has no such option |
 * | `suite`       | The `--suite` value, or null |
 *
 * Every attribute is present on every run; one that does not apply is null.
 * Options that change only where or how output is written (`--quiet`,
 * `--output-root`, `--label`, `--port`), and options whose effect another
 * attribute records (`--judges` in `judges`, `--model-override` in `models`),
 * are left out of `options`. The commit, judge and prompt versions, developer,
 * host and date are not attributes: they are what runs are compared across.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

export const MODEL_ROLES = ["generator", "narrator", "investigator", "judge"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** The first 12 hex digits of a SHA-256, as prompt versions are. */
const ShortHashSchema = z.string().regex(/^[0-9a-f]{12}$/);

export const SuiteInputSchema = z
  .object({
    id: z.string().min(1),
    /** The hash of the input's content (`contentHash`); null when it could not be read. */
    hash: ShortHashSchema.nullable(),
  })
  .strict();
export type SuiteInput = z.infer<typeof SuiteInputSchema>;

const LabelsSchema = z.array(z.string().min(1)).min(1).nullable();

export const SuiteAttributesSchema = z
  .object({
    command: z.string().min(1),
    options: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    inputs: z.array(SuiteInputSchema),
    judges: z.array(z.string().min(1)),
    models: z.object({ generator: LabelsSchema, narrator: LabelsSchema, investigator: LabelsSchema, judge: LabelsSchema }).strict(),
    samples: z.number().int().positive().nullable(),
    concurrency: z.number().int().positive().nullable(),
    suite: z.string().min(1).nullable(),
  })
  .strict();
export type SuiteAttributes = z.infer<typeof SuiteAttributesSchema>;

/** What a run command gives `createRunFolder`, which adds the command and the suite. */
export interface CommandAttributes {
  options: SuiteAttributes["options"];
  inputs: readonly SuiteInput[];
  judges: readonly string[];
  /** The labels each role ran on, in any order and repeated freely; a role left out, or given none, is null. */
  models: Partial<Record<ModelRole, readonly string[]>>;
  samples: number | null;
  concurrency: number | null;
}

/** JSON with every object's keys sorted, so equal values give equal text whatever their key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, each: unknown) => {
    if (each === null || typeof each !== "object" || Array.isArray(each)) return each;
    return Object.fromEntries(Object.entries(each as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

/** The first 12 hex digits of the SHA-256 of `value`'s canonical JSON: equal content, equal hash, whatever its layout on disk. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 12);
}

/** How a binding is named in `models`: its name and model, or its name alone when it names no model (the stubs). */
export function bindingLabel(binding: { name: string; model: string | null }): string {
  return binding.model ? `${binding.name}:${binding.model}` : binding.name;
}

/**
 * How a game server's narrator is named in `models`: `server:<backend>:<model>`
 * for an AI from `ai.json`, else `server:<name>` for one the server resolves
 * itself (`mock`, `default`). The backend and model, not the entry's name,
 * since names differ between machines. `default` stays its own label, though
 * a fresh database makes it mock: what it resolves to is the server's choice.
 */
export function serverNarratorLabel(name: string, entry: { backend: string; model: string } | undefined): string {
  return entry ? `server:${entry.backend}:${entry.model}` : `server:${name}`;
}

function sortedUnique(items: readonly string[]): string[] {
  return [...new Set(items)].sort();
}

/** The attributes of a run of `command` in `suite`, normalized: lists sorted, empty roles null. */
export function suiteAttributes(command: string, suite: string | null, attributes: CommandAttributes): SuiteAttributes {
  const models = Object.fromEntries(
    MODEL_ROLES.map((role) => {
      const labels = sortedUnique(attributes.models[role] ?? []);
      return [role, labels.length > 0 ? labels : null];
    }),
  ) as SuiteAttributes["models"];
  return SuiteAttributesSchema.parse({
    command,
    options: { ...attributes.options },
    inputs: [...attributes.inputs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((input) => ({ ...input })),
    judges: sortedUnique(attributes.judges),
    models,
    samples: attributes.samples,
    concurrency: attributes.concurrency,
    suite,
  });
}
