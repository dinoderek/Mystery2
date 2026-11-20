import type { MysteryStructure } from "./mystery-structure-schema.ts";

interface Step {
  id: string;
  bit: bigint;
  requires: bigint;
  location: string;
  speaker: string | null;
}
interface State {
  found: bigint;
  location: string;
  speaker: string | null;
  turns: number;
}

function solutionSteps(mystery: MysteryStructure): Step[] {
  const relevant = new Set<string>(mystery.solution.rule_ids);
  for (const id of relevant) {
    const node = mystery.nodes[id];
    const dependencies =
      node.kind === "rule"
        ? node.children
        : node.kind === "clue"
          ? (node.requires?.clue_ids ?? [])
          : [];
    dependencies.forEach((dependency) => relevant.add(dependency));
  }
  const clueIds = [...relevant].filter(
    (id) => mystery.nodes[id].kind === "clue",
  );
  const bits = new Map(clueIds.map((id, index) => [id, 1n << BigInt(index)]));
  return clueIds.map((id) => {
    const node = mystery.nodes[id];
    if (node.kind !== "clue") throw new Error(`Expected clue "${id}"`);
    const source = node.source;
    const speaker = source.kind === "talk" ? source.character_id : null;
    const character =
      source.kind === "talk" ? mystery.nodes[source.character_id] : undefined;
    const location =
      source.kind === "search"
        ? source.location_id
        : character?.kind === "character"
          ? character.location_id
          : "";
    return {
      id,
      bit: bits.get(id)!,
      requires: (node.requires?.clue_ids ?? []).reduce(
        (mask, dependency) => mask | bits.get(dependency)!,
        0n,
      ),
      location,
      speaker,
    };
  });
}

function solutionSupported(
  mystery: MysteryStructure,
  order: string[],
  discovered: Set<string>,
): boolean {
  for (const id of order) {
    const node = mystery.nodes[id];
    if (node.kind !== "rule") continue;
    const supported =
      node.operator === "AND"
        ? node.children.every((child) => discovered.has(child))
        : node.children.some((child) => discovered.has(child));
    if (supported) discovered.add(id);
  }
  return mystery.solution.rule_ids.some((id) => discovered.has(id));
}

function discover(step: Step, state: State): State {
  const moving = step.location !== state.location;
  const actionCost =
    step.speaker && !moving && step.speaker === state.speaker ? 0 : 1;
  return {
    found: state.found | step.bit,
    location: step.location,
    speaker: step.speaker,
    turns: state.turns + Number(moving) + actionCost,
  };
}

function requiredMasks(
  mystery: MysteryStructure,
  steps: Step[],
  order: string[],
  clueOrder: string[],
): bigint[] {
  const masks = new Map(steps.map((step) => [step.id, step.bit]));
  for (const id of clueOrder) {
    if (!masks.has(id)) continue;
    const node = mystery.nodes[id];
    if (node.kind !== "clue") continue;
    for (const dependency of node.requires?.clue_ids ?? []) {
      masks.set(id, masks.get(id)! | masks.get(dependency)!);
    }
  }
  for (const id of order) {
    const node = mystery.nodes[id];
    if (node.kind !== "rule") continue;
    const children = node.children.map((child) => masks.get(child) ?? 0n);
    const mask = children.reduce((left, right) =>
      node.operator === "AND" ? left | right : left & right,
    );
    masks.set(id, mask);
  }
  return mystery.solution.rule_ids.map((id) => masks.get(id)!);
}

function canAfford(
  state: State,
  steps: Step[],
  mandatory: bigint[],
  budget: number,
): boolean {
  return mandatory.some((mask) => {
    const remaining = steps.filter(
      (step) => (mask & step.bit) !== 0n && (state.found & step.bit) === 0n,
    );
    const searches = remaining.filter((step) => step.speaker === null).length;
    const conversations = new Set(
      remaining
        .map((step) => step.speaker)
        .filter((speaker) => speaker !== null && speaker !== state.speaker),
    );
    const moves = new Set(
      remaining
        .map((step) => step.location)
        .filter((location) => location !== state.location),
    );
    return state.turns + searches + conversations.size + moves.size <= budget;
  });
}

/** Searches actual discovery orders, sharing clues across AND/OR branches and counting revisits. */
export function hasBudgetedSolution(
  mystery: MysteryStructure,
  ruleOrder: string[],
  clueOrder: string[],
): boolean {
  const steps = solutionSteps(mystery);
  const mandatory = requiredMasks(mystery, steps, ruleOrder, clueOrder);
  const pending: State[] = [
    {
      found: 0n,
      location: mystery.opening.starting_location_id,
      speaker: null,
      turns: 0,
    },
  ];
  const cheapest = new Map<string, number>();
  while (pending.length > 0) {
    const state = pending.pop()!;
    if (!canAfford(state, steps, mandatory, mystery.metadata.time_budget))
      continue;
    const key = JSON.stringify([
      state.found.toString(),
      state.location,
      state.speaker,
    ]);
    if ((cheapest.get(key) ?? Infinity) <= state.turns) continue;
    cheapest.set(key, state.turns);
    const found = new Set(
      steps
        .filter((step) => (state.found & step.bit) !== 0n)
        .map((step) => step.id),
    );
    if (solutionSupported(mystery, ruleOrder, found)) return true;
    for (const step of steps) {
      if (
        (state.found & step.bit) !== 0n ||
        (state.found & step.requires) !== step.requires
      )
        continue;
      const next = discover(step, state);
      // Starting a conversation on the last turn forces accusation before any free questions.
      if (
        next.turns < mystery.metadata.time_budget ||
        (next.turns === mystery.metadata.time_budget && step.speaker === null)
      )
        pending.push(next);
    }
  }
  return false;
}
