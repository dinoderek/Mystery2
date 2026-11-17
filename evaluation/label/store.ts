/**
 * One game's label file, as the labelling page reads and appends to it.
 *
 * A save appends a label, checks the whole file with the truth schema, writes
 * it beside the file and renames it over, then reads it back: a failed save
 * leaves the file and what is in memory as they were. Saves of a game run one
 * after another.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { GAME_KINDS } from "../lib/truth/kinds.ts";
import type { GameKind } from "../lib/truth/kinds.ts";
import { LabelFileSchema, parseTruthFile } from "../lib/truth/schemas.ts";
import type { Fault, Label } from "../lib/truth/schemas.ts";
import type { FormState } from "./turns.ts";

/** A save the form cannot make: shown to the person, who can fix it. */
export class RejectedLabel extends Error {}

/**
 * The form's rows: each fault posts a `kind`, a `severity` and a `note`, in
 * that order, so the three lists line up. A value the page never offers is
 * refused here; what the person can fix is refused by `faultsOf`, with the
 * form kept as typed.
 */
export function parseForm(body: string): FormState {
  const params = new URLSearchParams(body);
  const kinds = params.getAll("kind");
  const severities = params.getAll("severity");
  const notes = params.getAll("note");
  if (severities.length !== kinds.length || notes.length !== kinds.length) throw new RejectedLabel("every fault needs a kind, a severity and a note field");
  const unknown = kinds.find((kind) => kind !== "" && !(GAME_KINDS as readonly string[]).includes(kind));
  if (unknown !== undefined) throw new RejectedLabel(`"${unknown}" is not a kind of fault`);
  const badSeverity = severities.find((severity) => severity !== "minor" && severity !== "major");
  if (badSeverity !== undefined) throw new RejectedLabel(`"${badSeverity}" is not a severity`);
  return {
    faults: kinds.map((kind, index) => ({ kind, severity: severities[index] as "minor" | "major", note: notes[index].trim() })),
  };
}

function faultsOf(form: FormState): Fault[] {
  const seen = new Set<string>();
  for (const fault of form.faults) {
    if (fault.kind === "") throw new RejectedLabel("choose a kind for every fault, or remove the fault");
    if (fault.note === "") throw new RejectedLabel(`a fault needs a note saying what is wrong: the ${fault.kind.replace(/_/g, " ")} fault has none`);
    if (seen.has(fault.kind)) throw new RejectedLabel(`two faults are ${fault.kind.replace(/_/g, " ")}: give each kind one fault, its note saying everything wrong`);
    seen.add(fault.kind);
  }
  return form.faults.map((fault) => ({ kind: fault.kind as GameKind, severity: fault.severity, note: fault.note }));
}

export class GameLabels {
  /** Every label, in file order, including those a later label replaced. */
  readonly labels: Label[];
  private saving: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  private readonly now: () => Date;

  constructor(file: string, labels: readonly Label[], now: () => Date) {
    this.file = file;
    this.labels = [...labels];
    this.now = now;
  }

  /** Takes the labels the file holds now, so a label added to it since is kept, never overwritten. */
  async refresh(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${this.file} is not JSON: ${(error as Error).message}`, { cause: error });
    }
    this.labels.splice(0, this.labels.length, ...parseTruthFile(LabelFileSchema, parsed, this.file).labels);
  }

  /** Appends the turn's label, given by `by` in `pass`. */
  save(sequence: number, form: FormState, by: string, pass: 1 | 2): Promise<void> {
    const run = this.saving.then(() => this.write(sequence, form, by, pass));
    this.saving = run.catch(() => undefined);
    return run;
  }

  /** A time later than every label of the turn, so two labels never share one. */
  private stamp(sequence: number): string {
    let at = this.now().getTime();
    for (const label of this.labels) {
      if (label.sequence === sequence && Date.parse(label.at) >= at) at = Date.parse(label.at) + 1;
    }
    return new Date(at).toISOString();
  }

  private async replaceFile(content: string): Promise<void> {
    const temporary = `${this.file}.saving`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.writeFile(temporary, content, "utf8");
      await fs.rename(temporary, this.file);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private async write(sequence: number, form: FormState, by: string, pass: 1 | 2): Promise<void> {
    await this.refresh();
    const label: Label = { sequence, faults: faultsOf(form), by, at: this.stamp(sequence), pass };
    const next = { labels: [...this.labels, label] };
    const checked = LabelFileSchema.safeParse(next);
    if (!checked.success) {
      throw new RejectedLabel(checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
    await this.replaceFile(`${JSON.stringify(next, null, 2)}\n`);
    await this.refresh();
  }
}
