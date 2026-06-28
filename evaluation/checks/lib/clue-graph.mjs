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
// Shared by evaluation/checks/mechanical.mjs and
// evaluation/checks/analyzers/clue-graph.mjs so both agree on graph semantics.

// Collect every clue in the blueprint with its owner and prerequisite ids.
// Returns Map<clueId, { id, owner: { kind, id, name }, requires: string[] }>.
export function collectClues(blueprint) {
  const clues = new Map();
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

function solutionClueIds(blueprint) {
  const ids = new Set();
  for (const path of blueprint?.solution_paths ?? []) {
    for (const id of path.location_clue_ids ?? []) ids.add(id);
    for (const id of path.character_clue_ids ?? []) ids.add(id);
  }
  return ids;
}

function pathClueIds(path) {
  return [...(path.location_clue_ids ?? []), ...(path.character_clue_ids ?? [])];
}

// Compute the full structural analysis of the discovery graph.
export function analyzeClueGraph(blueprint) {
  const clues = collectClues(blueprint);
  const allClueIds = new Set(clues.keys());

  // Reference integrity: unknown prerequisite ids and self-references.
  const unknownRequires = [];
  const selfReferences = [];
  for (const [clueId, { requires }] of clues) {
    for (const dep of requires) {
      if (dep === clueId) selfReferences.push(clueId);
      else if (!allClueIds.has(dep)) {
        unknownRequires.push({ clue_id: clueId, missing: dep });
      }
    }
  }

  // Adjacency over known, non-self edges only.
  const requiresOf = (id) =>
    (clues.get(id)?.requires ?? []).filter(
      (dep) => dep !== id && allClueIds.has(dep),
    );

  // Cycle detection via DFS coloring (0=unvisited, 1=in-stack, 2=done).
  const color = new Map();
  const cycles = [];
  const stack = [];
  const seenCycleNodes = new Set();
  const visit = (id) => {
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
  const discoverable = new Set();
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
  const depthMemo = new Map();
  const depthOf = (id) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    depthMemo.set(id, 0); // guard against cycles
    const deps = requiresOf(id);
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
    depthMemo.set(id, d);
    return d;
  };

  // Per-reasoning-path shape, for the judge's fun/fairness call.
  const describePath = (path, group) => {
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
