import { BlueprintV2Schema, type BlueprintV2 } from "../../packages/shared/src/blueprint-schema-v2.ts";
import { StoryBriefSchema, type StoryBrief } from "../../packages/blueprint-generator/src/story-brief.ts";
import { analyzeClueGraph } from "./lib/clue-graph.ts";

export interface MechanicalCheck {
  id: string;
  kind: "mechanical";
  status: "pass" | "fail";
  details: Record<string, unknown> | null;
}

// Runs the checks on a candidate blueprint. With a brief, it is checked first
// and the blueprint is compared with it; without one (a blueprint validated on
// its own) only the checks that need no brief run.
export function runMechanicalChecks({
  brief,
  blueprintCandidate,
}: {
  brief?: unknown;
  blueprintCandidate: unknown;
}): MechanicalCheck[] {
  const checks: MechanicalCheck[] = [];

  let validBrief: StoryBrief | null = null;
  if (brief !== undefined && brief !== null) {
    const briefParse = StoryBriefSchema.safeParse(brief);
    checks.push(
      mkCheck(
        "brief_schema_valid",
        briefParse.success,
        briefParse.success ? null : { issues: briefParse.error.format() },
      ),
    );
    if (!briefParse.success) return checks;
    validBrief = briefParse.data;
  }

  const bpParse = BlueprintV2Schema.safeParse(blueprintCandidate);
  checks.push(
    mkCheck(
      "blueprint_schema_valid",
      bpParse.success,
      bpParse.success ? null : { issues: bpParse.error.format() },
    ),
  );
  if (!bpParse.success) return checks;
  const blueprint = bpParse.data;

  if (validBrief) checks.push(...briefChecks(validBrief, blueprint));
  checks.push(...structureChecks(blueprint));
  return checks;
}

// The checks that compare the blueprint with the counts its brief asks for.
function briefChecks(validBrief: StoryBrief, blueprint: BlueprintV2): MechanicalCheck[] {
  const checks: MechanicalCheck[] = [];
  const expectedCulprits = validBrief.culprits ?? 1;
  const actualCulprits = blueprint.world.characters.filter((c) => c.is_culprit).length;
  checks.push(
    mkCheck("culprit_count_matches_brief", actualCulprits === expectedCulprits, {
      expected: expectedCulprits,
      actual: actualCulprits,
    }),
  );

  if (validBrief.locations !== undefined) {
    const actualLocations = blueprint.world.locations.length;
    checks.push(
      mkCheck("location_count_matches_brief", actualLocations === validBrief.locations, {
        expected: validBrief.locations,
        actual: actualLocations,
      }),
    );
  }

  checks.push(...characterCountChecks(validBrief, blueprint));

  if (validBrief.redHerringTrails !== undefined) {
    const actualHerrings = blueprint.red_herrings.length;
    checks.push(
      mkCheck("red_herring_count_matches_brief", actualHerrings === validBrief.redHerringTrails, {
        expected: validBrief.redHerringTrails,
        actual: actualHerrings,
      }),
    );
  }
  return checks;
}

// The character count the brief's culprits, suspects and witnesses add up to.
function characterCountChecks(validBrief: StoryBrief, blueprint: BlueprintV2): MechanicalCheck[] {
  if (validBrief.suspects === undefined && validBrief.witnesses === undefined) return [];
  const culprits = validBrief.culprits ?? 1;
  const suspects = validBrief.suspects ?? 0;
  const witnesses = validBrief.witnesses ?? 0;
  const expected = culprits + suspects + witnesses;
  const actual = blueprint.world.characters.length;
  return [
    mkCheck("character_count_matches_brief", actual === expected, {
      expected,
      actual,
      breakdown: { culprits, suspects, witnesses },
    }),
  ];
}

// The checks that need only the blueprint.
function structureChecks(blueprint: BlueprintV2): MechanicalCheck[] {
  const checks: MechanicalCheck[] = [];
  const orphans = findOrphanClues(blueprint);
  const orphanCount = orphans.location.length + orphans.character.length;
  checks.push(
    mkCheck("no_orphan_clues", orphanCount === 0, orphanCount === 0 ? null : orphans),
  );

  // requires_satisfiable: the clue discovery graph must reference real clues, be
  // acyclic, and keep every solution clue reachable from ungated roots. Defense
  // in depth alongside the schema's superRefine — surfaces the specifics in the
  // result even though a malformed graph already fails schema parse.
  const graph = analyzeClueGraph(blueprint);
  checks.push(
    mkCheck("requires_satisfiable", graph.ok, graph.ok ? null : {
      unknown_requires: graph.unknown_requires,
      self_references: graph.self_references,
      cycles: graph.cycles,
      locked_solution_clues: graph.locked_solution_clues,
    }),
  );
  return checks;
}

function mkCheck(id: string, passed: boolean, details?: Record<string, unknown> | null): MechanicalCheck {
  return {
    id,
    kind: "mechanical",
    status: passed ? "pass" : "fail",
    details: details ?? null,
  };
}

function referencedClueIds(bp: BlueprintV2): Set<string> {
  const referenced = new Set<string>();
  const allPaths = [...bp.solution_paths, ...bp.red_herrings, ...bp.suspect_elimination_paths];
  for (const p of allPaths) {
    for (const id of p.location_clue_ids) referenced.add(id);
    for (const id of p.character_clue_ids) referenced.add(id);
  }
  return referenced;
}

export function findOrphanClues(bp: BlueprintV2): { location: string[]; character: string[] } {
  const referenced = referencedClueIds(bp);
  const unreferenced = (clues: ReadonlyArray<{ id: string }>) =>
    clues.filter((clue) => !referenced.has(clue.id)).map((clue) => clue.id);

  return {
    location: bp.world.locations.flatMap((loc) => [
      ...unreferenced(loc.clues),
      ...(loc.sub_locations ?? []).flatMap((sub) => unreferenced(sub.clues)),
    ]),
    character: bp.world.characters.flatMap((ch) => unreferenced(ch.clues)),
  };
}
