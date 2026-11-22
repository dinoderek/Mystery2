/**
 * The registry: every check and every judge evaluation can run, in one list.
 *
 * A check is code that decides; a judge is one model call. Each entry has an
 * id, unique across the whole list, and the kinds of subject it applies to:
 * a `blueprint`, a played `game`, or one `turn`. A judge's entry also carries
 * what the model is sent (its brief, schema and preamble, or a prompt built in
 * code), its default context, how its verdict is reached and which blueprint
 * ids its answer may cite.
 *
 * A harness asks the registry for the entries of its subject kind, in order,
 * and runs them. Adding a check or a judge is adding an entry here, and the
 * files it names. Paths are relative to the repository root.
 *
 * A judge marked `candidate` is outside the default battery: it runs only
 * when a run names it, and a run that does not name it records nothing for it.
 *
 * A blueprint subject comes in two formats, each with its own checks and
 * judges: a Blueprint V2, and a clue-graph case (`docs/clue-graph.md`). An
 * entry with `format: "clue_graph"` applies only to a case; one without, only
 * to a Blueprint V2.
 */

export const SUBJECT_KINDS = ["blueprint", "game", "turn"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const BLUEPRINT_FORMATS = ["v2", "clue_graph"] as const;
export type BlueprintFormat = (typeof BLUEPRINT_FORMATS)[number];

/**
 * How a judge's verdict is reached. `stated`: the model's own `verdict` is
 * taken. `major_findings`: the verdict fails on any `major` finding, whatever
 * the model says (`resolveVerdict` in `evaluation/judges/index.ts`).
 */
export const VERDICT_RULES = ["stated", "major_findings"] as const;
export type VerdictRule = (typeof VERDICT_RULES)[number];

/** Sets of ids a judge's answer may cite, read from the blueprint it judged. */
export type IdSetName =
  | "solution_path_ids"
  | "elimination_path_ids"
  | "clue_ids"
  | "character_ids"
  | "non_culprit_ids"
  | "player_text_paths"
  | "probe_topics"
  | "case_clue_ids"
  | "case_conclusion_ids"
  | "case_character_ids"
  | "case_ids"
  | "case_step_ids";

/**
 * One rule an answer must obey beyond its schema. `at` is a path into the
 * answer, where `[]` stands for every item of an array: `paths[].id`.
 *
 * - `ref`: every value at `at` is a member of `set` (a blueprint set, or the
 *   values another path of the answer holds). `unique` forbids repeats,
 *   `covers` requires every member of the set to appear, `optional` lets a
 *   nullish value pass (or an empty string with `"blank"`); `skipIfEmpty` drops
 *   the rule when the set is empty.
 * - `equals`: the value at `at` is the blueprint's target age.
 * - `field_of`: each item at `at` names a blueprint character by `id`, and
 *   its `field` equals that character's.
 * - `nonempty_when`: an item at `at` whose `when.field` is `when.equals` has
 *   a non-empty `field`.
 */
export type IdCheck =
  | {
      kind: "ref";
      at: string;
      set: IdSetName | { answer: string };
      label: string;
      unique?: boolean;
      covers?: boolean;
      optional?: "nullish" | "blank";
      skipIfEmpty?: boolean;
    }
  | { kind: "equals"; at: string; to: "target_age" }
  | { kind: "field_of"; at: string; id: string; field: string }
  | {
      kind: "nonempty_when";
      at: string;
      when: { field: string; equals: string };
      field: string;
      hint: string;
    };

/** Code to run: a module and the name it exports. */
export interface CodeRef {
  module: string;
  export: string;
}

export interface CheckEntry {
  type: "check";
  id: string;
  subjects: readonly SubjectKind[];
  /** Several checks may share one function that reports each of them. */
  run: CodeRef;
  /** Settings the check reads. */
  context?: Readonly<Record<string, unknown>>;
  /** Set on a check of a clue-graph case; absent on a Blueprint V2 check. */
  format?: "clue_graph";
}

/** A judge whose prompt is a brief, a schema and a preamble kept in files. */
export interface FilePrompt {
  kind: "files";
  brief: string;
  schema: string;
  preamble: string;
}

/** A judge whose prompt is built in code, from a profile, for each subject. */
export interface BuiltPrompt {
  kind: "built";
  builder: "turn_age";
  /** The file the prompt is built in, which the judge's version hashes. */
  source: string;
}

export interface JudgeEntry {
  type: "judge";
  id: string;
  subjects: readonly SubjectKind[];
  prompt: FilePrompt | BuiltPrompt;
  verdict: VerdictRule;
  /** Settings sent to the judge with its subject; absent when it needs none. */
  context?: Readonly<Record<string, unknown>>;
  /** A deterministic analyzer that runs beside the judge; the dimension passes when both do. */
  analyzer?: CodeRef;
  /** Blueprint ids the answer may cite, declared here and read by the validator. */
  idChecks?: readonly IdCheck[];
  /** Outside the default battery: runs only when named. */
  candidate?: true;
  /** Set on a judge of a clue-graph case; absent on a Blueprint V2 judge. */
  format?: "clue_graph";
  /** A clue-graph judge also sent the player's view of the case (`evaluation/blueprint/player-view.ts`). */
  playerView?: true;
}

export type RegistryEntry = CheckEntry | JudgeEntry;

const DIMENSIONS = "evaluation/dimensions";
const JUDGES = "evaluation/judges";
const BLUEPRINT_PREAMBLE = "evaluation/prompts/judge-system.md";
const CLUE_GRAPH_PREAMBLE = "evaluation/prompts/clue-graph-judge-system.md";
const GAME_MASTER_PREAMBLE = "evaluation/judges/prompts/judge-system.md";

function blueprintJudge(
  id: string,
  extra: Pick<JudgeEntry, "context" | "analyzer" | "idChecks"> = {},
): JudgeEntry {
  const slug = id.replaceAll("_", "-");
  return {
    type: "judge",
    id,
    subjects: ["blueprint"],
    prompt: {
      kind: "files",
      brief: `${DIMENSIONS}/${slug}.md`,
      schema: `${DIMENSIONS}/${slug}.schema.ts`,
      preamble: BLUEPRINT_PREAMBLE,
    },
    verdict: "stated",
    ...extra,
  };
}

/** The game-master judges grade a played game and a single turn the same way. */
function gameMasterJudge(id: string): JudgeEntry {
  const slug = id.replaceAll("_", "-");
  return {
    type: "judge",
    id,
    subjects: ["game", "turn"],
    prompt: {
      kind: "files",
      brief: `${JUDGES}/${slug}.md`,
      schema: `${JUDGES}/${slug}.schema.ts`,
      preamble: GAME_MASTER_PREAMBLE,
    },
    verdict: "major_findings",
  };
}

/**
 * A candidate judge: a merged or broad alternative to judges of the default
 * battery, with its brief and schema beside theirs. Each of its findings names
 * a kind of the truth set's vocabulary, so it fails on any `major` finding.
 */
function candidateJudge(id: string, subjects: readonly SubjectKind[], context?: Readonly<Record<string, unknown>>): JudgeEntry {
  const slug = id.replaceAll("_", "-");
  const dir = subjects.includes("blueprint") ? DIMENSIONS : JUDGES;
  return {
    type: "judge",
    id,
    subjects,
    prompt: {
      kind: "files",
      brief: `${dir}/${slug}.md`,
      schema: `${dir}/${slug}.schema.ts`,
      preamble: subjects.includes("blueprint") ? BLUEPRINT_PREAMBLE : GAME_MASTER_PREAMBLE,
    },
    verdict: "major_findings",
    ...(context ? { context } : {}),
    candidate: true,
  };
}

/**
 * A judge of a clue-graph case. Its brief and schema sit beside the V2
 * dimensions'; each finding is `major` or `minor`, and it fails on a major one.
 */
function clueGraphJudge(id: string, extra: Pick<JudgeEntry, "idChecks" | "playerView"> = {}): JudgeEntry {
  const slug = id.replaceAll("_", "-");
  return {
    type: "judge",
    id,
    subjects: ["blueprint"],
    prompt: {
      kind: "files",
      brief: `${DIMENSIONS}/${slug}.md`,
      schema: `${DIMENSIONS}/${slug}.schema.ts`,
      preamble: CLUE_GRAPH_PREAMBLE,
    },
    verdict: "major_findings",
    format: "clue_graph",
    ...extra,
  };
}

function blueprintCheck(id: string): CheckEntry {
  return {
    type: "check",
    id,
    subjects: ["blueprint"],
    run: { module: "evaluation/checks/mechanical.ts", export: "runMechanicalChecks" },
  };
}

function gameCheck(id: string, context?: Readonly<Record<string, unknown>>): CheckEntry {
  return {
    type: "check",
    id,
    subjects: ["game"],
    run: { module: "evaluation/trace/lib/mechanical.ts", export: "runTraceMechanicalChecks" },
    ...(context ? { context } : {}),
  };
}

/** The ids a clue-graph finding may cite: any clue, conclusion, character or location of the case. */
const CASE_FINDING_IDS = { kind: "ref", at: "findings[].ids[]", set: "case_ids", label: "case clue, conclusion, character or location id" } as const;

/** A reference to a blueprint character id; the rule it is spread into says where in the answer. */
const CHARACTER_REF = {
  kind: "ref",
  set: "character_ids",
  label: "blueprint character id",
} as const;

/** The fallback floor on solve-path length, used when a brief sets no minPathLength. */
const SOLVE_FLOOR = { min_clues: 3 } as const;

/** What a player may ask any character, the same for every mystery. */
const PROBE_TOPICS = [
  "their own background and a brief sketch of their life",
  "their likes and dislikes",
  "their personality, attitude, and appearance",
  "their knowledge of the other characters",
  "their knowledge of the locations",
  "their knowledge of the central mystery",
] as const;

/** Every check and judge, in the order a harness runs them. */
export const REGISTRY: readonly RegistryEntry[] = [
  blueprintCheck("brief_schema_valid"),
  blueprintCheck("blueprint_schema_valid"),
  blueprintCheck("culprit_count_matches_brief"),
  blueprintCheck("location_count_matches_brief"),
  blueprintCheck("character_count_matches_brief"),
  blueprintCheck("red_herring_count_matches_brief"),
  blueprintCheck("no_orphan_clues"),
  blueprintCheck("requires_satisfiable"),
  blueprintCheck("location_locks_are_pointers"),
  blueprintCheck("pointers_point_to_target"),
  blueprintCheck("self_protect_has_parts"),
  blueprintCheck("parts_name_real_clues"),
  blueprintCheck("descriptions_hide_locked_spots"),

  blueprintJudge("solve_depth", {
    context: SOLVE_FLOOR,
    idChecks: [
      {
        kind: "ref",
        at: "paths[].id",
        set: "solution_path_ids",
        label: "blueprint solution path id",
        unique: true,
        covers: true,
      },
      {
        kind: "ref",
        at: "paths[].necessary_clues[]",
        set: "clue_ids",
        label: "blueprint clue id",
      },
      {
        kind: "ref",
        at: "shortest_path_id",
        set: { answer: "paths[].id" },
        label: "enumerated path id",
        optional: "nullish",
      },
      {
        kind: "ref",
        at: "elimination_paths[].id",
        set: "elimination_path_ids",
        label: "blueprint suspect elimination path id",
        unique: true,
        covers: true,
      },
      { ...CHARACTER_REF, at: "elimination_paths[].suspect_id", optional: "blank" },
      {
        kind: "ref",
        at: "elimination_paths[].necessary_clues[]",
        set: "clue_ids",
        label: "blueprint clue id",
      },
      {
        kind: "ref",
        at: "uncovered_suspects[]",
        set: "non_culprit_ids",
        label: "non-culprit character id",
      },
    ],
  }),
  blueprintJudge("fairness", {
    idChecks: [
      {
        kind: "ref",
        at: "non_culprits[].character_id",
        set: "non_culprit_ids",
        label: "non-culprit character id",
        unique: true,
        covers: true,
      },
    ],
  }),
  blueprintJudge("timeline_coherence"),
  blueprintJudge("knowledge_coherence", {
    idChecks: [
      {
        kind: "ref",
        at: "issues[].clue_ids[]",
        set: "clue_ids",
        label: "blueprint clue id",
      },
      {
        kind: "nonempty_when",
        at: "issues[]",
        when: { field: "kind", equals: "pre_discovery_leak" },
        field: "clue_ids",
        hint: "name the clue it gives away",
      },
    ],
  }),
  blueprintJudge("character_grounding", {
    context: { probe_topics: PROBE_TOPICS },
    idChecks: [
      { ...CHARACTER_REF, at: "characters[].character_id", unique: true, covers: true },
      {
        kind: "field_of",
        at: "characters[]",
        id: "character_id",
        field: "first_name",
      },
      {
        kind: "ref",
        at: "characters[].topics[].topic",
        set: "probe_topics",
        label: "context.probe_topics entry, copied verbatim",
        skipIfEmpty: true,
      },
      { ...CHARACTER_REF, at: "reactions[].character_id" },
      { kind: "ref", at: "reactions[].clue_ids[]", set: "clue_ids", label: "blueprint clue id" },
    ],
  }),
  blueprintJudge("path_payoff"),
  blueprintJudge("clue_graph", {
    analyzer: { module: "evaluation/checks/analyzers/clue-graph.ts", export: "analyze" },
    idChecks: [{ kind: "ref", at: "locks[].clue_id", set: "clue_ids", label: "blueprint clue id", unique: true }],
  }),
  blueprintJudge("age_appropriate", {
    context: { tolerance: 2, min_words: 8 },
    analyzer: { module: "evaluation/checks/analyzers/age-appropriate.ts", export: "analyze" },
    idChecks: [
      { kind: "equals", at: "target_age", to: "target_age" },
      {
        kind: "ref",
        at: "findings[].path",
        set: "player_text_paths",
        label: "player-facing string path of the blueprint, spelled exactly",
      },
    ],
  }),

  {
    type: "check",
    id: "clue_graph_valid",
    subjects: ["blueprint"],
    run: { module: "evaluation/checks/clue-graph-case.ts", export: "runClueGraphChecks" },
    format: "clue_graph",
  },
  clueGraphJudge("cg_soundness", {
    idChecks: [
      {
        kind: "ref",
        at: "conclusions[].conclusion_id",
        set: "case_conclusion_ids",
        label: "case conclusion id",
        unique: true,
        covers: true,
      },
      CASE_FINDING_IDS,
    ],
  }),
  clueGraphJudge("cg_truth_agreement", { idChecks: [CASE_FINDING_IDS] }),
  clueGraphJudge("cg_character_grounding", {
    idChecks: [
      {
        kind: "ref",
        at: "characters[].character_id",
        set: "case_character_ids",
        label: "case character id",
        unique: true,
        covers: true,
      },
      CASE_FINDING_IDS,
    ],
  }),
  clueGraphJudge("cg_step_sense", {
    playerView: true,
    idChecks: [
      {
        kind: "ref",
        at: "steps[].clue_id",
        set: "case_step_ids",
        label: "step id from player_view.steps",
        unique: true,
        covers: true,
      },
      CASE_FINDING_IDS,
    ],
  }),

  gameCheck("clue_accounting"),
  gameCheck("spoiler_leak", { spoiler_min_run: 12 }),
  // Off by default: set `enforce_requires` to run it.
  gameCheck("clue_requires_violation", { enforce_requires: false }),

  gameMasterJudge("gm_roleplay"),
  gameMasterJudge("gm_clue_discipline"),
  gameMasterJudge("gm_fabrication"),
  gameMasterJudge("gm_spoiler"),

  {
    type: "check",
    id: "flesch",
    subjects: ["turn"],
    run: { module: "evaluation/runtime/lib/flesch.ts", export: "judge" },
  },
  {
    // The blueprint dimension `age_appropriate` is a different judge: it reads
    // a blueprint's player-facing text, this one a turn's narration.
    type: "judge",
    id: "age_appropriate_turn",
    subjects: ["turn"],
    prompt: { kind: "built", builder: "turn_age", source: "evaluation/core/judge-prompt.ts" },
    verdict: "stated",
  },

  candidateJudge("solve_depth_fairness", ["blueprint"], SOLVE_FLOOR),
  candidateJudge("knowledge_timeline_coherence", ["blueprint"]),
  candidateJudge("blueprint_broad", ["blueprint"], { ...SOLVE_FLOOR, probe_topics: PROBE_TOPICS }),
  candidateJudge("gm_broad", ["game", "turn"]),
];

export function isSubjectKind(value: unknown): value is SubjectKind {
  return SUBJECT_KINDS.includes(value as SubjectKind);
}

/** The entry with this id, or undefined. */
export function findEntry(id: string): RegistryEntry | undefined {
  return REGISTRY.find((entry) => entry.id === id);
}

/** The entry with this id; throws, naming the ids there are, when there is none. */
export function getEntry(id: string): RegistryEntry {
  const entry = findEntry(id);
  if (!entry) {
    throw new Error(`Unknown check or judge "${id}". Known: ${REGISTRY.map((e) => e.id).join(", ")}`);
  }
  return entry;
}

export function getJudgeEntry(id: string): JudgeEntry {
  const entry = getEntry(id);
  if (entry.type !== "judge") throw new Error(`"${id}" is a check, not a judge.`);
  return entry;
}

/** Whether an entry applies to a blueprint of this format; game and turn entries carry none. */
function ofFormat(entry: RegistryEntry, format: BlueprintFormat): boolean {
  return (entry.format ?? "v2") === format;
}

/**
 * The judges that apply to a subject kind, in registry order: the default
 * battery, or with `candidates` also every candidate, which is what a run may
 * name. A blueprint's are those of its `format`, Blueprint V2 by default.
 */
export function judgesFor(
  subject: SubjectKind,
  { candidates = false, format = "v2" }: { candidates?: boolean; format?: BlueprintFormat } = {},
): JudgeEntry[] {
  return REGISTRY.filter(
    (e): e is JudgeEntry =>
      e.type === "judge" && e.subjects.includes(subject) && (candidates || e.candidate !== true) && ofFormat(e, format),
  );
}

/** The checks that apply to a subject kind, in registry order; a blueprint's are those of its `format`. */
export function checksFor(subject: SubjectKind, format: BlueprintFormat = "v2"): CheckEntry[] {
  return REGISTRY.filter((e): e is CheckEntry => e.type === "check" && e.subjects.includes(subject) && ofFormat(e, format));
}
