import path from "node:path";

import ts from "typescript";
import { z } from "zod";

import { BASELINE_EXTRA_PATHS, BASELINE_SERVER_PATHS } from "../../core/baseline-sources.ts";
import type { BaselineSources } from "../../core/baseline-sources.ts";
import type { Binding, ResolvedBinding } from "../../core/config.ts";
import { READ_PATHS } from "../../core/baseline-status.ts";
import { NARRATOR_PROMPT_FILES } from "../../core/prompt-versions.ts";
import { REGISTRY } from "../../core/registry.ts";
import { contentHash } from "../../core/suite-attributes.ts";
import type { CommandAttributes } from "../../core/suite-attributes.ts";
import { baselinePrompts, PROMPT_FAMILIES } from "./baseline-prompts.ts";

const repositoryPath = z.string().min(1).refine((file) => !path.posix.isAbsolute(file) && file.split("/").every((part) => part !== ".." && part !== "."));
const digest = z.string().regex(/^(?:[a-f0-9]{12}|[a-f0-9]{40}|[a-f0-9]{64})$/).nullable();

export const BaselineScopeSchema = z.object({
  case_paths: z.array(repositoryPath),
  blueprints: z.array(repositoryPath),
  judges: z.array(z.string()),
  prompts: z.array(z.enum(["talk", "search", "accusation", "opening", "movement"])),
  external_inputs: z.boolean(),
  server: z.boolean(),
}).strict();
export type BaselineScope = z.infer<typeof BaselineScopeSchema>;

const SourceGroupSchema = z.object({
  category: z.enum(["Narrator prompts", "Judges", "Cases", "Blueprints", "Shared code"]),
  name: z.string(),
  files: z.record(digest),
}).strict();
export type SourceGroup = z.infer<typeof SourceGroupSchema>;

const CaseInputSchema = z.object({
  id: z.string(),
  action: z.string(),
  case_hash: digest,
  blueprints: z.array(repositoryPath),
  judges: z.array(z.string()),
}).strict();
export type BaselineCaseInput = z.infer<typeof CaseInputSchema>;

export const BaselineInputsSchema = z.object({
  version: z.literal(1),
  history_anchor: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  scope: BaselineScopeSchema,
  sources: z.array(SourceGroupSchema),
  cases: z.array(CaseInputSchema),
  settings: z.object({
    narrator_models: z.array(z.string()),
    judge_models: z.array(z.string()),
    samples: z.number().int().positive().nullable(),
    concurrency: z.number().int().positive().nullable(),
    ai_profile: z.string().nullable(),
    bindings: z.record(digest).optional(),
  }).strict(),
}).strict();
export type BaselineInputs = z.infer<typeof BaselineInputsSchema>;

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

type BindingSettings = Pick<Binding, "cmd" | "args" | "extract_path" | "timeout_ms" | "retries">;

/** Save effective binding behavior as a digest so local arguments stay out of the baseline. */
export function baselineBindingHash({ cmd, args, extract_path, timeout_ms, retries }: BindingSettings): string {
  return contentHash({ cmd, args, extract_path, timeout_ms, retries });
}

export function baselineSettings(
  attributes: CommandAttributes, aiProfile: string | null, bindings: readonly ResolvedBinding[],
): BaselineInputs["settings"] {
  return {
    narrator_models: sortedUnique(attributes.models.narrator ?? []),
    judge_models: sortedUnique(attributes.models.judge ?? []),
    samples: attributes.samples,
    concurrency: attributes.concurrency,
    ai_profile: aiProfile,
    bindings: Object.fromEntries(bindings.map((binding) => [binding.name, baselineBindingHash(binding)])),
  };
}

function under(file: string, item: string): boolean {
  return file === item || file.startsWith(`${item}/`);
}

function sourceGroup(sources: BaselineSources, category: SourceGroup["category"], name: string, files: readonly string[]): SourceGroup {
  return { category, name, files: Object.fromEntries(sortedUnique(files).map((file) => [file, sources.digest(file)])) };
}

function judgeFiles(id: string): readonly string[] {
  const entry = REGISTRY.find((item) => item.id === id);
  if (entry?.type === "judge") {
    const { prompt } = entry;
    if (prompt.kind === "built") return [prompt.source];
    return [prompt.brief, prompt.schema, prompt.preamble];
  }
  return id === "flesch" ? ["evaluation/lib/readability.ts"] : [];
}

function sharedFile(file: string, judgePaths: ReadonlySet<string>, server: boolean): boolean {
  if (judgePaths.has(file) || file.endsWith("/README.md") || file.endsWith("/AGENTS.md")) return false;
  if (under(file, "evaluation/runtime/cases")) return under(file, "evaluation/runtime/cases/clue-graph/support");
  if (server && BASELINE_SERVER_PATHS.some((item) => under(file, item))) return true;
  return [...READ_PATHS, ...BASELINE_EXTRA_PATHS].some((item) => under(file, item));
}

const CASE_MODULE = /\.(?:m?js|ts|json)$/;

function relativeImport(sources: BaselineSources, owner: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const file = path.posix.join(path.posix.dirname(owner), specifier);
  if (file === ".." || file.startsWith("../")) return undefined;
  return [file, `${file}.ts`, `${file}.js`, `${file}/index.ts`].find((candidate) => sources.has(candidate));
}

function caseFiles(sources: BaselineSources, target: string, shared: ReadonlySet<string>): string[] {
  const entries = sources.has(target) || CASE_MODULE.test(target)
    ? [target]
    : sources.children(target).filter((file) => CASE_MODULE.test(file));
  const visited = new Set(entries);
  for (const file of visited) {
    if (file.endsWith(".json")) continue;
    const text = sources.text(file);
    if (text === null) continue;
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      const dependency = relativeImport(sources, file, fileName);
      if (dependency && !shared.has(dependency)) visited.add(dependency);
    }
  }
  return [...visited];
}

/** Compare source data from either the worktree or a Git tree using the same scope. */
const JUDGE_REGISTRY = "evaluation/core/registry.ts";

export function baselineSourceGroups(sources: BaselineSources, scope: BaselineScope, recorded?: readonly SourceGroup[]): SourceGroup[] {
  const prompts = baselinePrompts(sources);
  const judges = scope.judges.map((id) => {
    const previous = recorded?.find((group) => group.category === "Judges" && group.name === id);
    return sourceGroup(sources, "Judges", id, previous ? Object.keys(previous.files) : judgeFiles(id));
  });
  // Registration may point a judge at a new brief. Historical refs use the
  // recorded paths, and changes in this shared wiring get their own line.
  const allJudgePaths = new Set([JUDGE_REGISTRY, ...REGISTRY.flatMap((entry) => judgeFiles(entry.id)), ...judges.flatMap((group) => Object.keys(group.files))]);
  const shared = sources.paths.filter((file) => sharedFile(file, allJudgePaths, scope.server) && sources.digest(file) !== null);
  const sharedPaths = new Set(shared);
  const promptFiles = shared.filter((file) => NARRATOR_PROMPT_FILES.includes(file));
  const engine = shared.filter((file) => file.startsWith("packages/") && !NARRATOR_PROMPT_FILES.includes(file));
  const harness = shared.filter((file) => !file.startsWith("packages/"));
  const sharedPrompts = sourceGroup(sources, "Narrator prompts", "shared wording and assembly", promptFiles);
  for (const [file, hash] of prompts.shared) sharedPrompts.files[file] = hash;
  return [
    ...PROMPT_FAMILIES.filter((family) => scope.prompts.includes(family)).map((family): SourceGroup =>
      ({ category: "Narrator prompts", name: family, files: Object.fromEntries(prompts.family(family)) })),
    sharedPrompts,
    ...judges,
    ...(scope.judges.length > 0 ? [sourceGroup(sources, "Judges", "shared selection and wiring", [JUDGE_REGISTRY])] : []),
    ...scope.case_paths.map((target) => sourceGroup(sources, "Cases", target, caseFiles(sources, target, sharedPaths))),
    ...scope.blueprints.map((file) => sourceGroup(sources, "Blueprints", file, [file])),
    sourceGroup(sources, "Shared code", "engine", engine),
    sourceGroup(sources, "Shared code", "evaluation harness and dependencies", harness),
  ];
}

type ChangeKind = "added" | "removed" | "changed" | "unverifiable";

interface InputChange {
  category: SourceGroup["category"] | "Run settings";
  name: string;
  files: Array<{ path: string; kind: ChangeKind }>;
  note?: string;
}

function digestChange(before: string | null | undefined, after: string | null | undefined, prompt: boolean): ChangeKind | null {
  if (before === null || (after === null && prompt)) return "unverifiable";
  if (before === after) return null;
  if (before === undefined) return after === null ? "unverifiable" : "added";
  if (after == null) return "removed";
  return "changed";
}

function groupChanges(before: SourceGroup | undefined, after: SourceGroup | undefined): Array<{ path: string; kind: ChangeKind }> {
  const old = before?.files ?? {};
  const next = after?.files ?? {};
  return sortedUnique([...Object.keys(old), ...Object.keys(next)]).flatMap((file) => {
    const kind = digestChange(
      Object.hasOwn(old, file) ? old[file] : undefined, Object.hasOwn(next, file) ? next[file] : undefined,
      (before ?? after)?.category === "Narrator prompts",
    );
    return kind === null ? [] : [{ path: file, kind }];
  });
}

export function baselineChanges(before: readonly SourceGroup[], after: readonly SourceGroup[]): InputChange[] {
  const key = (group: SourceGroup) => `${group.category}\0${group.name}`;
  const old = new Map(before.map((group) => [key(group), group]));
  const next = new Map(after.map((group) => [key(group), group]));
  const groups = new Map([...old, ...next]);
  return [...groups].flatMap(([id, group]) => {
    const files = groupChanges(old.get(id), next.get(id));
    if (files.length > 0) return [{ category: group.category, name: group.name, files }];
    return Boolean(old.has(id)) === Boolean(next.has(id)) ? [] : [{ category: group.category, name: group.name, files: [] }];
  });
}

export function runInputChanges(before: BaselineInputs, after: BaselineInputs): InputChange[] {
  // A spot check can cover a smaller set. Case scores show membership and the
  // resolved-case hashes below compare the inputs it actually has in common.
  const common = (left: readonly SourceGroup[], right: readonly SourceGroup[]) =>
    left.filter((group) => group.category !== "Cases" && right.some((item) => item.category === group.category && item.name === group.name));
  const changes = baselineChanges(common(before.sources, after.sources), common(after.sources, before.sources));
  const oldCases = new Map(before.cases.map((item) => [item.id, item]));
  for (const item of after.cases) {
    const old = oldCases.get(item.id);
    if (!old || contentHash(old) === contentHash(item)) continue;
    changes.push({ category: "Cases", name: item.id, files: [] });
  }
  const { bindings: oldBindings, ...oldSettings } = before.settings;
  const { bindings: newBindings, ...newSettings } = after.settings;
  for (const key of Object.keys(oldSettings) as Array<keyof typeof oldSettings>) {
    if (contentHash(oldSettings[key]) === contentHash(newSettings[key])) continue;
    const display = (value: BaselineInputs["settings"][typeof key]) => Array.isArray(value) ? (value.join(", ") || "none") : String(value ?? "default");
    changes.push({
      category: "Run settings", name: key.replaceAll("_", " "), files: [],
      note: `${display(oldSettings[key])} → ${display(newSettings[key])}`,
    });
  }
  if (!oldBindings || !newBindings) {
    changes.push({ category: "Run settings", name: "bindings", files: [], note: "unverifiable" });
  } else {
    for (const name of sortedUnique([...Object.keys(oldBindings), ...Object.keys(newBindings)])) {
      const kind = digestChange(oldBindings[name], newBindings[name], false);
      if (kind) changes.push({ category: "Run settings", name, files: [], note: `binding ${kind}` });
    }
  }
  return changes;
}

function shortName(change: InputChange): string {
  if (change.category === "Blueprints" || change.category === "Cases") return path.posix.basename(change.name);
  return change.name;
}

export function baselineChangeLines(changes: readonly InputChange[], details: boolean): string[] {
  const categories = new Map<InputChange["category"], InputChange[]>();
  for (const change of changes) {
    const group = categories.get(change.category) ?? [];
    group.push(change);
    categories.set(change.category, group);
  }
  const lines: string[] = [];
  for (const [category, group] of categories) {
    const labels = group.map((change) => {
      const note = change.note ?? (change.files.some((file) => file.kind === "unverifiable") ? "unverifiable" : null);
      return shortName(change) + (note ? ` (${note})` : "");
    });
    const shown = details ? labels : labels.slice(0, 8);
    lines.push(`  ${category}: ${shown.join(", ")}${shown.length < labels.length ? ` (+${labels.length - shown.length} more)` : ""}`);
    if (details) {
      for (const change of group) {
        for (const file of change.files) lines.push(`    ${file.kind}: ${file.path}`);
      }
    }
  }
  return lines;
}
