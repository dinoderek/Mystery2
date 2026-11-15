/**
 * A suite file: what `./dev eval suite <name>` judges, with what, how often,
 * and the thresholds it must meet. Suite files live in `evaluation/suites/`,
 * one JSON file each, named by the suite's name; the command's `--help` lists
 * every field.
 *
 * What a file says about the registry and the truth set (a judge id that
 * exists, a subject the set has) is checked when the suite is planned
 * (`plan.ts`); this file holds only the shape.
 */

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { InputError } from "../core/errors.ts";
import { TRUTH_ID } from "../lib/truth/schemas.ts";

/** The suite files, relative to the repository root. */
export const SUITES_DIR = "evaluation/suites";

const IdSchema = z.string().regex(TRUTH_ID, "an id is lower-case letters, digits and hyphens");

/** Every subject of a part of the truth set, or the ones named. */
const SelectionSchema = z.union([
  z.literal("all"),
  z
    .array(IdSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { message: "an id is named once" }),
]);
export type Selection = z.infer<typeof SelectionSchema>;

const ShareSchema = z.number().min(0).max(1);

export const ThresholdSchema = z
  .object({
    /** A judge of the suite, or `<judge>@<model>` for one of its models; absent for every judge. */
    judge: z.string().min(1).optional(),
    /** One of the judge's kinds; absent for each of them. */
    kind: z.string().min(1).optional(),
    /** Of the real faults judged, the share found must be at least this. */
    min_found_of_real: ShareSchema.optional(),
    /** Of the units reported, the share that are real faults must be at least this. */
    min_real_of_reported: ShareSchema.optional(),
    /** At most this many verdicts that did not judge (`error`). */
    max_errors: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((threshold) => threshold.min_found_of_real !== undefined || threshold.min_real_of_reported !== undefined || threshold.max_errors !== undefined, {
    message: "a threshold sets min_found_of_real, min_real_of_reported or max_errors",
  });
export type Threshold = z.infer<typeof ThresholdSchema>;

export const SuiteSchema = z
  .object({
    description: z.string().optional(),
    subjects: z
      .object({
        bases: SelectionSchema.optional(),
        blueprint_plants: SelectionSchema.optional(),
        games: SelectionSchema.optional(),
        game_variants: SelectionSchema.optional(),
      })
      .strict()
      .refine((subjects) => Object.values(subjects).some((selection) => selection !== undefined), {
        message: "a suite names at least one part: bases, blueprint_plants, games or game_variants",
      }),
    judges: z
      .array(z.string().min(1))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, { message: "a judge is named once" }),
    /** By binding, the models its judges run on; a binding left out runs on its own model. */
    models: z
      .record(
        z
          .array(z.string().min(1))
          .min(1)
          .refine((models) => new Set(models).size === models.length, { message: "a model is named once" }),
      )
      .default({}),
    /** How many times each judge judges each subject on each model. */
    samples: z.number().int().positive().default(1),
    /** How many subjects are judged at once; the judges of one subject always run side by side. */
    concurrency: z.number().int().positive().default(1),
    thresholds: z.array(ThresholdSchema).default([]),
  })
  .strict();
export type Suite = z.infer<typeof SuiteSchema>;

export interface SuiteFile {
  /** The file's name less `.json`: it names the suite's state under the output root. */
  name: string;
  file: string;
  suite: Suite;
}

/** The file `arg` names: a suite file's path, else a suite's name in `evaluation/suites/`. */
export function locateSuite(arg: string, root: string): string {
  const given = path.resolve(arg);
  if (fs.existsSync(given) && fs.statSync(given).isFile()) return given;
  const named = path.join(root, SUITES_DIR, `${arg}.json`);
  if (TRUTH_ID.test(arg) && fs.existsSync(named)) return named;
  throw new InputError(`no suite file at ${given}, and no suite named "${arg}" in ${path.join(root, SUITES_DIR)}`);
}

/** Reads and checks a suite file; an unreadable or malformed one is an input error, which exits 1. */
export function readSuiteFile(file: string): SuiteFile {
  const name = path.basename(file, ".json");
  if (!TRUTH_ID.test(name)) throw new InputError(`${file}: a suite file is named <name>.json, the name in lower-case letters, digits and hyphens`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new InputError(`${file}: cannot be read as JSON: ${(error as Error).message}`);
  }
  const parsed = SuiteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(`${file}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`);
  }
  return { name, file, suite: parsed.data };
}
