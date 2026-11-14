/**
 * The loader: turns a registry entry into what runs it. A judge's definition
 * is its brief, its Zod schema and its preamble read from the files the entry
 * names; an analyzer or a check is the function its entry points at.
 *
 * Nothing is found by naming convention: a file the registry does not name is
 * never loaded, and one it names that is missing or malformed fails loudly.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { z } from "zod";

import { getEntry, getJudgeEntry } from "./registry.ts";
import type { CodeRef, JudgeEntry } from "./registry.ts";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/** The repository root, absolute. */
export function repoRoot(): string {
  return REPO_ROOT;
}

/** A registry path, which is relative to the repository root, made absolute. */
export function resolveRegistryPath(file: string): string {
  return path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
}

export interface JudgeDefinition {
  id: string;
  entry: JudgeEntry;
  /** The brief: the prose contract the judge is asked to follow. Empty for a judge whose prompt is built in code. */
  text: string;
  /** Where the brief was read from, absolute. */
  filePath: string | null;
  /** The schema the answer must satisfy; null for a judge whose answer is checked in code. */
  schema: z.ZodType | null;
  schemaPath: string | null;
  /** The evaluator preamble every prompt of this judge starts with. */
  preamble: string | null;
}

async function importExport(ref: CodeRef, what: string): Promise<unknown> {
  const file = resolveRegistryPath(ref.module);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  if (typeof mod[ref.export] !== "function") {
    throw new Error(`${what} must export a function named '${ref.export}' from ${ref.module}.`);
  }
  return mod[ref.export];
}

async function loadSchema(id: string, schemaPath: string): Promise<z.ZodType> {
  const mod = (await import(pathToFileURL(schemaPath).href)) as { schema?: z.ZodType };
  if (typeof mod.schema?.safeParse !== "function") {
    throw new Error(`${id} schema must export a named 'schema' (Zod schema).`);
  }
  return mod.schema;
}

/** Load a judge by id, or from an entry that is not registered (a test's). */
export async function loadJudge(idOrEntry: string | JudgeEntry): Promise<JudgeDefinition> {
  const entry = typeof idOrEntry === "string" ? getJudgeEntry(idOrEntry) : idOrEntry;
  if (entry.prompt.kind === "built") {
    return { id: entry.id, entry, text: "", filePath: null, schema: null, schemaPath: null, preamble: null };
  }
  const filePath = resolveRegistryPath(entry.prompt.brief);
  const schemaPath = resolveRegistryPath(entry.prompt.schema);
  const [text, preamble, schema] = await Promise.all([
    fs.readFile(filePath, "utf8"),
    fs.readFile(resolveRegistryPath(entry.prompt.preamble), "utf8"),
    loadSchema(entry.id, schemaPath),
  ]);
  return { id: entry.id, entry, text, filePath, schema, schemaPath, preamble };
}

export interface Analyzer {
  dimensionId: string;
  analyzerPath: string;
  analyze: (input: { brief?: unknown; blueprint: unknown; context: unknown }) => unknown;
}

/** The analyzer that runs beside a judge, or null when its entry names none. */
export async function loadAnalyzer(id: string): Promise<Analyzer | null> {
  const { analyzer } = getJudgeEntry(id);
  if (!analyzer) return null;
  const analyze = (await importExport(analyzer, `Analyzer for "${id}"`)) as Analyzer["analyze"];
  return { dimensionId: id, analyzerPath: resolveRegistryPath(analyzer.module), analyze };
}

/**
 * The function that runs a check. It may report several checks at once: the
 * mechanical checks of a blueprint are one function, so a caller picks out its
 * own id from what it returns.
 */
export async function loadCheck(id: string): Promise<(...args: unknown[]) => unknown> {
  const entry = getEntry(id);
  if (entry.type !== "check") throw new Error(`"${id}" is a judge, not a check.`);
  return (await importExport(entry.run, `Check "${id}"`)) as (
    ...args: unknown[]
  ) => unknown;
}
