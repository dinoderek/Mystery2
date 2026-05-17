import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";
import { StoryBriefSchema } from "../../packages/blueprint-generator/src/story-brief.ts";

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
      mkCheck("red_herring_count_meets_brief", actualHerrings >= validBrief.redHerringTrails, {
        expected_min: validBrief.redHerringTrails,
        actual: actualHerrings,
      }),
    );
  }

  if (validBrief.mustInclude && validBrief.mustInclude.length > 0) {
    const searchableText = collectBlueprintText(blueprint).toLowerCase();
    for (const term of validBrief.mustInclude) {
      const found = searchableText.includes(term.toLowerCase());
      checks.push(
        mkCheck(`must_include_term:${term}`, found, found ? null : { term }),
      );
    }
  }

  const orphans = findOrphanClues(blueprint);
  const orphanCount = orphans.location.length + orphans.character.length;
  checks.push(
    mkCheck("no_orphan_clues", orphanCount === 0, orphanCount === 0 ? null : orphans),
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

function collectBlueprintText(bp) {
  const parts = [];
  parts.push(bp.metadata.title, bp.metadata.one_liner);
  parts.push(bp.narrative.premise, bp.narrative.starting_knowledge.mystery_summary);
  for (const sk of bp.narrative.starting_knowledge.locations) parts.push(sk.summary);
  for (const sk of bp.narrative.starting_knowledge.characters) parts.push(sk.summary);
  parts.push(bp.cover_image.description);
  parts.push(bp.ground_truth.what_happened, bp.ground_truth.why_it_happened);
  for (const t of bp.ground_truth.timeline) parts.push(t);
  for (const loc of bp.world.locations) {
    parts.push(loc.name, loc.description);
    for (const clue of loc.clues) parts.push(clue.text);
    for (const sub of loc.sub_locations ?? []) {
      parts.push(sub.name, sub.hint);
      for (const clue of sub.clues) parts.push(clue.text);
    }
  }
  for (const ch of bp.world.characters) {
    parts.push(ch.first_name, ch.last_name, ch.appearance, ch.background, ch.personality);
    parts.push(ch.initial_attitude_towards_investigator);
    if (ch.stated_alibi) parts.push(ch.stated_alibi);
    if (ch.motive) parts.push(ch.motive);
    for (const clue of ch.clues) parts.push(clue.text);
    for (const f of ch.flavor_knowledge) parts.push(f);
    for (const a of ch.actual_actions) parts.push(a.summary);
  }
  return parts.join("\n");
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
