// Deterministic helpers for the clue discovery graph.
//
// A clue may carry an optional `requires` gate ({ clue_ids, rationale }) meaning
// it cannot be discovered until every listed clue has been discovered. The set of
// clues plus these prerequisite edges forms an implicit directed graph. These
// helpers build that graph and compute the structural facts both the
// `requires_satisfiable` mechanical check and the `clue_graph` analyzer rely on:
// unknown / self references, cycles, reachability from ungated roots, and whether
// the solution stays discoverable.
//
// Shared by evaluation/checks/mechanical.ts and
// evaluation/checks/analyzers/clue-graph.ts so both agree on graph semantics.

interface GraphClue {
  id: string;
  requires?: { clue_ids?: string[] } | null;
}

interface GraphPath {
  id: string;
  location_clue_ids?: string[];
  character_clue_ids?: string[];
}

/** The fields read below, all optional: a candidate blueprint need not be well formed. */
export interface ClueGraphBlueprint {
  world?: {
    locations?: Array<{
      id: string;
      name: string;
      clues?: GraphClue[];
      sub_locations?: Array<{ clues?: GraphClue[] }>;
    }>;
    characters?: Array<{ id: string; first_name: string; last_name: string; clues?: GraphClue[] }>;
  };
  solution_paths?: GraphPath[];
  red_herrings?: GraphPath[];
  suspect_elimination_paths?: GraphPath[];
}

export interface ClueRecord {
  id: string;
  owner: { kind: "location" | "character"; id: string; name: string };
  requires: string[];
}

export type PathGroup = "solution" | "red_herring" | "suspect_elimination";

// Collect every clue in the blueprint with its owner and prerequisite ids.
export function collectClues(blueprint: ClueGraphBlueprint | null | undefined): Map<string, ClueRecord> {
  const clues = new Map<string, ClueRecord>();
  for (const location of blueprint?.world?.locations ?? []) {
    for (const clue of location.clues ?? []) {
      clues.set(clue.id, {
        id: clue.id,
        owner: { kind: "location", id: location.id, name: location.name },
        requires: clue.requires?.clue_ids ?? [],
      });
    }
    for (const sub of location.sub_locations ?? []) {
      for (const clue of sub.clues ?? []) {
        clues.set(clue.id, {
          id: clue.id,
          owner: { kind: "location", id: location.id, name: location.name },
          requires: clue.requires?.clue_ids ?? [],
        });
      }
    }
  }
  for (const character of blueprint?.world?.characters ?? []) {
    for (const clue of character.clues ?? []) {
      clues.set(clue.id, {
        id: clue.id,
        owner: {
          kind: "character",
          id: character.id,
          name: `${character.first_name} ${character.last_name}`.trim(),
        },
        requires: clue.requires?.clue_ids ?? [],
      });
    }
  }
  return clues;
}

function solutionClueIds(blueprint: ClueGraphBlueprint | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const path of blueprint?.solution_paths ?? []) {
    for (const id of path.location_clue_ids ?? []) ids.add(id);
    for (const id of path.character_clue_ids ?? []) ids.add(id);
  }
  return ids;
}

function pathClueIds(path: GraphPath): string[] {
  return [...(path.location_clue_ids ?? []), ...(path.character_clue_ids ?? [])];
}

export interface PathShape {
  id: string;
  group: PathGroup;
  clue_count: number;
  root_count: number;
  gated_count: number;
  max_depth: number | null;
  is_single_chain: boolean;
  has_ungated_entry: boolean;
}

export interface ClueGraphAnalysis {
  total_clues: number;
  gated_clue_count: number;
  unknown_requires: Array<{ clue_id: string; missing: string }>;
  self_references: string[];
  acyclic: boolean;
  cycles: string[][];
  discoverable: string[];
  undiscoverable: string[];
  locked_solution_clues: string[];
  solution_locked: boolean;
  paths: PathShape[];
  ok: boolean;
}

// Compute the full structural analysis of the discovery graph.
export function analyzeClueGraph(blueprint: ClueGraphBlueprint | null | undefined): ClueGraphAnalysis {
  const clues = collectClues(blueprint);
  const allClueIds = new Set(clues.keys());

  // Reference integrity: unknown prerequisite ids and self-references.
  const unknownRequires: Array<{ clue_id: string; missing: string }> = [];
  const selfReferences: string[] = [];
  for (const [clueId, { requires }] of clues) {
    for (const dep of requires) {
      if (dep === clueId) selfReferences.push(clueId);
      else if (!allClueIds.has(dep)) {
        unknownRequires.push({ clue_id: clueId, missing: dep });
      }
    }
  }

  // Adjacency over known, non-self edges only.
  const requiresOf = (id: string): string[] =>
    (clues.get(id)?.requires ?? []).filter(
      (dep) => dep !== id && allClueIds.has(dep),
    );

  // Cycle detection via DFS coloring (0=unvisited, 1=in-stack, 2=done).
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const seenCycleNodes = new Set<string>();
  const visit = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const dep of requiresOf(id)) {
      const depColor = color.get(dep) ?? 0;
      if (depColor === 1) {
        if (!seenCycleNodes.has(dep)) {
          const start = stack.indexOf(dep);
          const cycle = start >= 0 ? stack.slice(start) : [dep];
          for (const node of cycle) seenCycleNodes.add(node);
          cycles.push(cycle);
        }
      } else if (depColor === 0) {
        visit(dep);
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of allClueIds) {
    if ((color.get(id) ?? 0) === 0) visit(id);
  }
  const acyclic = cycles.length === 0;

  // Reachability: a clue is discoverable when all its prerequisites are
  // discoverable (fixpoint from ungated roots).
  const discoverable = new Set<string>();
  for (const id of allClueIds) {
    if (requiresOf(id).length === 0) discoverable.add(id);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of allClueIds) {
      if (discoverable.has(id)) continue;
      if (requiresOf(id).every((dep) => discoverable.has(dep))) {
        discoverable.add(id);
        grew = true;
      }
    }
  }
  const undiscoverable = [...allClueIds].filter((id) => !discoverable.has(id));

  // Solution reachability.
  const solutionClues = solutionClueIds(blueprint);
  const lockedSolutionClues = [...solutionClues].filter(
    (id) => allClueIds.has(id) && !discoverable.has(id),
  );

  // Longest prerequisite chain depth per clue (only meaningful when acyclic).
  const depthMemo = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depthMemo.get(id);
    if (known !== undefined) return known;
    depthMemo.set(id, 0); // guard against cycles
    const deps = requiresOf(id);
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
    depthMemo.set(id, d);
    return d;
  };

  // Per-reasoning-path shape, for the judge's fun/fairness call.
  const describePath = (path: GraphPath, group: PathGroup): PathShape => {
    const ids = pathClueIds(path).filter((id) => allClueIds.has(id));
    const idSet = new Set(ids);
    const rootCount = ids.filter((id) => requiresOf(id).length === 0).length;
    const gatedCount = ids.filter((id) => requiresOf(id).length > 0).length;
    const maxDepth = acyclic && ids.length > 0
      ? Math.max(0, ...ids.map(depthOf))
      : null;
    // A single chain: every clue in the path has at most one path-internal
    // prerequisite and is required by at most one other path clue.
    let isSingleChain = ids.length >= 3 && rootCount === 1;
    if (isSingleChain) {
      const inPath = new Map(ids.map((id) => [id, 0]));
      for (const id of ids) {
        const internalDeps = requiresOf(id).filter((dep) => idSet.has(dep));
        if (internalDeps.length > 1) isSingleChain = false;
        for (const dep of internalDeps) inPath.set(dep, (inPath.get(dep) ?? 0) + 1);
      }
      if ([...inPath.values()].some((count) => count > 1)) isSingleChain = false;
    }
    return {
      id: path.id,
      group,
      clue_count: ids.length,
      root_count: rootCount,
      gated_count: gatedCount,
      max_depth: maxDepth,
      is_single_chain: isSingleChain,
      has_ungated_entry: rootCount > 0,
    };
  };

  const paths = [
    ...(blueprint?.solution_paths ?? []).map((p) => describePath(p, "solution")),
    ...(blueprint?.red_herrings ?? []).map((p) => describePath(p, "red_herring")),
    ...(blueprint?.suspect_elimination_paths ?? []).map((p) =>
      describePath(p, "suspect_elimination"),
    ),
  ];

  const gatedClueCount = [...clues.values()].filter(
    (c) => c.requires.length > 0,
  ).length;

  const ok =
    unknownRequires.length === 0 &&
    selfReferences.length === 0 &&
    acyclic &&
    lockedSolutionClues.length === 0;

  return {
    total_clues: allClueIds.size,
    gated_clue_count: gatedClueCount,
    unknown_requires: unknownRequires,
    self_references: selfReferences,
    acyclic,
    cycles,
    discoverable: [...discoverable],
    undiscoverable,
    locked_solution_clues: lockedSolutionClues,
    solution_locked: lockedSolutionClues.length > 0,
    paths,
    ok,
  };
}
