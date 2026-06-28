import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";
import { StoryBriefSchema } from "../../packages/blueprint-generator/src/story-brief.ts";
import { analyzeClueGraph } from "./lib/clue-graph.mjs";

export function runMechanicalChecks({ brief, blueprintCandidate }) {
  const checks = [];

  const briefParse = StoryBriefSchema.safeParse(brief);
  checks.push(
    mkCheck(
      "brief_schema_valid",
      briefParse.success,
      briefParse.success ? null : { issues: briefParse.error.format() },
    ),
  );
  if (!briefParse.success) return checks;
  const validBrief = briefParse.data;

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

  if (validBrief.suspects !== undefined || validBrief.witnesses !== undefined) {
    const expectedChars =
      (validBrief.culprits ?? 1) + (validBrief.suspects ?? 0) + (validBrief.witnesses ?? 0);
    const actualChars = blueprint.world.characters.length;
    checks.push(
      mkCheck("character_count_matches_brief", actualChars === expectedChars, {
        expected: expectedChars,
        actual: actualChars,
        breakdown: {
          culprits: validBrief.culprits ?? 1,
          suspects: validBrief.suspects ?? 0,
          witnesses: validBrief.witnesses ?? 0,
        },
      }),
    );
  }

  if (validBrief.redHerringTrails !== undefined) {
    const actualHerrings = blueprint.red_herrings.length;
    checks.push(
      mkCheck("red_herring_count_matches_brief", actualHerrings === validBrief.redHerringTrails, {
        expected: validBrief.redHerringTrails,
        actual: actualHerrings,
      }),
    );
  }

  const orphans = findOrphanClues(blueprint);
  const orphanCount = orphans.location.length + orphans.character.length;
  checks.push(
    mkCheck("no_orphan_clues", orphanCount === 0, orphanCount === 0 ? null : orphans),
  );

  // requires_satisfiable: the clue discovery graph must reference real clues, be
  // acyclic, and keep every solution clue reachable from ungated roots. Defense
  // in depth alongside the schema's superRefine — surfaces the specifics in the
  // envelope summary even though a malformed graph already fails schema parse.
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

function mkCheck(id, passed, details) {
  return {
    id,
    kind: "mechanical",
    status: passed ? "pass" : "fail",
    details: details ?? null,
  };
}

function findOrphanClues(bp) {
  const referenced = new Set();
  const allPaths = [...bp.solution_paths, ...bp.red_herrings, ...bp.suspect_elimination_paths];
  for (const p of allPaths) {
    for (const id of p.location_clue_ids) referenced.add(id);
    for (const id of p.character_clue_ids) referenced.add(id);
  }

  const orphans = { location: [], character: [] };
  for (const loc of bp.world.locations) {
    for (const clue of loc.clues) {
      if (!referenced.has(clue.id)) orphans.location.push(clue.id);
    }
    for (const sub of loc.sub_locations ?? []) {
      for (const clue of sub.clues) {
        if (!referenced.has(clue.id)) orphans.location.push(clue.id);
      }
    }
  }
  for (const ch of bp.world.characters) {
    for (const clue of ch.clues) {
      if (!referenced.has(clue.id)) orphans.character.push(clue.id);
    }
  }
  return orphans;
}
