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
 * A blueprint subject is a clue-graph case (`docs/clue-graph.md`).
 */

export const SUBJECT_KINDS = ["blueprint", "game", "turn"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * How a judge's verdict is reached. `stated`: the model's own `verdict` is
 * taken. `major_findings`: the verdict fails on any `major` finding, whatever
 * the model says (`resolveVerdict` in `evaluation/judges/index.ts`).
 */
export const VERDICT_RULES = ["stated", "major_findings"] as const;
export type VerdictRule = (typeof VERDICT_RULES)[number];

/** Sets of ids a judge's answer may cite, read from the case it judged. */
export type IdSetName = "case_clue_ids" | "case_conclusion_ids" | "case_character_ids" | "case_ids" | "case_step_ids";

/**
 * One rule an answer must obey beyond its schema. `at` is a path into the
 * answer, where `[]` stands for every item of an array: `steps[].clue_id`.
 *
 * - `ref`: every value at `at` is a member of `set`. `unique` forbids repeats
 *   and `covers` requires every member of the set to appear.
 */
export type IdCheck = {
  kind: "ref";
  at: string;
  set: IdSetName;
  label: string;
  unique?: boolean;
  covers?: boolean;
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
  /** Case ids the answer may cite, declared here and read by the validator. */
  idChecks?: readonly IdCheck[];
  /** Outside the default battery: runs only when named. */
  candidate?: true;
  /** Set on a judge of a clue-graph case; its version's hash covers it. */
  format?: "clue_graph";
  /** A clue-graph judge also sent the player's view of the case (`evaluation/blueprint/player-view.ts`). */
  playerView?: true;
}

export type RegistryEntry = CheckEntry | JudgeEntry;

const DIMENSIONS = "evaluation/dimensions";
const JUDGES = "evaluation/judges";
const CLUE_GRAPH_PREAMBLE = "evaluation/prompts/clue-graph-judge-system.md";
const GAME_MASTER_PREAMBLE = "evaluation/judges/prompts/judge-system.md";

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
 * A candidate judge: a broad alternative to judges of the default battery,
 * with its brief and schema beside theirs. Each of its findings names a
 * finding kind, so it fails on any `major` finding.
 */
function candidateJudge(id: string, subjects: readonly SubjectKind[]): JudgeEntry {
  const slug = id.replaceAll("_", "-");
  return {
    type: "judge",
    id,
    subjects,
    prompt: {
      kind: "files",
      brief: `${JUDGES}/${slug}.md`,
      schema: `${JUDGES}/${slug}.schema.ts`,
      preamble: GAME_MASTER_PREAMBLE,
    },
    verdict: "major_findings",
    candidate: true,
  };
}

/** A judge of a clue-graph case: each finding is `major` or `minor`, and it fails on a major one. */
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

function gameCheck(id: string, context?: Readonly<Record<string, unknown>>): CheckEntry {
  return {
    type: "check",
    id,
    subjects: ["game"],
    run: { module: "evaluation/trace/lib/mechanical.ts", export: "runTraceMechanicalChecks" },
    ...(context ? { context } : {}),
  };
}

/** The ids a clue-graph finding may cite: any clue, conclusion, character or location of the case, or `opening`. */
const CASE_FINDING_IDS = {
  kind: "ref",
  at: "findings[].ids[]",
  set: "case_ids",
  label: "case clue, conclusion, character or location id, or opening",
} as const;

/** Every check and judge, in the order a harness runs them. */
export const REGISTRY: readonly RegistryEntry[] = [
  {
    type: "check",
    id: "clue_graph_valid",
    subjects: ["blueprint"],
    run: { module: "evaluation/checks/clue-graph-case.ts", export: "runClueGraphChecks" },
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
    type: "judge",
    id: "age_appropriate_turn",
    subjects: ["turn"],
    prompt: { kind: "built", builder: "turn_age", source: "evaluation/core/judge-prompt.ts" },
    verdict: "stated",
  },

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

/** The judges that apply to a subject kind, in registry order: the default battery, or with `candidates` also every candidate, which is what a run may name. */
export function judgesFor(subject: SubjectKind, { candidates = false }: { candidates?: boolean } = {}): JudgeEntry[] {
  return REGISTRY.filter((e): e is JudgeEntry => e.type === "judge" && e.subjects.includes(subject) && (candidates || e.candidate !== true));
}

/** The checks that apply to a subject kind, in registry order. */
export function checksFor(subject: SubjectKind): CheckEntry[] {
  return REGISTRY.filter((e): e is CheckEntry => e.type === "check" && e.subjects.includes(subject));
}
