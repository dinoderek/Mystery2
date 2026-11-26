// A clue-graph case built to the counts asked of it, for the size checks: at a
// size's floors by default, and with any one count moved to break it alone.
// Everyone stands in the first location, so every route is short.

import {
  SIZE_TABLE,
  type ClueGraphCase,
  type ClueGraphSize,
  type SizeCount,
} from "@my2/shared";

type Clue = ClueGraphCase["clues"][string];
type Rule = ClueGraphCase["conclusions"][string]["rule"];

/** The counts a fixture is built to, as `measureCase` reads them. */
export type Shape = Record<SizeCount, number>;

/** A size's floors: each count's minimum. */
export function floors(size: ClueGraphSize): Shape {
  return Object.fromEntries(
    Object.entries(SIZE_TABLE[size]).map(([name, range]) => [name, range.min]),
  ) as Shape;
}

function person(name: string, role: "culprit" | "suspect" | "witness") {
  return {
    name,
    location: "place_0",
    role,
    sex: "female" as const,
    personality: "Calm.",
    demeanor: { open: "Friendly." },
    knows: [],
    appearance: [`${name} is tall.`, `${name} wears a red coat.`],
  };
}

const statement = (character: string, fact: string, reached: unknown, extra: object = {}): Clue =>
  ({ kind: "statement", fact, source: { character }, truth: true, reached, ...extra }) as Clue;
const asked = (about: string, prompted_by: string[]) => ({ by: "asked", about, prompted_by });
const gated = (gate: object) => ({ by: "gated", gate });

/** A valid case with exactly the counts of `shape`, declared as `size` unless that is null. */
export function sizedCase(shape: Shape, size: ClueGraphSize | null = null): ClueGraphCase {
  const suspects = Array.from({ length: shape.suspects }, (_, index) => `suspect_${index + 1}`);
  const witnesses = Array.from({ length: shape.witnesses }, (_, index) => `witness_${index + 1}`);
  const witness = (index: number) => witnesses[index % witnesses.length];
  const alibi = shape.false_alibis > 0;
  // A witness's lie, taken back: an alibi when it clears a suspect. The culprit tells at most three.
  const witnessLie = alibi || shape.false_statements > 3;
  const cleared = shape.cleared_on_every_route > 0;
  const lies = shape.false_statements - (witnessLie ? 1 : 0);
  const extraGated = shape.gated_clues - shape.false_statements - 1;
  // Each route without the confession: the shared evidence, one clue of its own, and a clearing.
  const shared = shape.shortest_route - 1 - (cleared ? 1 : 0);
  // One route without the confession at least; the confession's is the rest.
  const plainRoutes = Math.max(1, shape.culprit_routes - 1);
  const confessionRoute = shape.culprit_routes > plainRoutes;
  if (shared < 1 || shape.hidden_spots > shared || extraGated < 0 || plainRoutes < 0)
    throw new Error(`No fixture fits ${JSON.stringify(shape)}`);

  const clues: Record<string, Clue> = {};
  const spots: { name: string; revealed_by?: string }[] = [];
  const evidence = (id: string, revealedBy?: string) => {
    const spot = `the spot for ${id}`;
    spots.push(revealedBy ? { name: spot, revealed_by: revealedBy } : { name: spot });
    clues[id] = { kind: "evidence", fact: `A finding: ${id}.`, source: { location: "place_0", spot } };
  };

  const sharedIds = Array.from({ length: shared }, (_, index) => `evidence_${index + 1}`);
  sharedIds.forEach((id, index) => {
    const hidden = index < shape.hidden_spots;
    const pointer = `pointer_${index}`;
    if (hidden) clues[pointer] = statement(witness(index), `Look at ${id}.`, asked("where to look", ["opening"]));
    evidence(id, hidden ? pointer : undefined);
  });
  const first = sharedIds[0];

  const ownClues = Array.from({ length: plainRoutes }, (_, index) => {
    if (index === 0 && witnessLie) {
      clues.saw_culprit = statement(witness(1), "Someone saw the culprit.", asked("what was seen", ["alibi_retracted"]));
      return "saw_culprit";
    }
    evidence(`route_${index + 1}`);
    return `route_${index + 1}`;
  });

  const admissions = Array.from({ length: lies }, (_, index) => {
    clues[`lie_${index + 1}`] = statement("culprit", `The culprit's lie ${index + 1}.`, { by: "first_meeting" }, {
      truth: false,
      why: "To hide.",
    });
    clues[`admits_${index + 1}`] = statement("culprit", `The culprit admits ${index + 1}.`, gated({ use: { any: [first] } }), {
      takes_back: [`lie_${index + 1}`],
    });
    return `admits_${index + 1}`;
  });
  clues.confession = statement(
    "culprit",
    "The culprit confesses.",
    gated(admissions.length > 0 ? { after: admissions } : { use: { any: [first] } }),
  );

  const conclusions: ClueGraphCase["conclusions"] = {};
  suspects.forEach((suspect, index) => {
    const id = `${suspect}_cleared`;
    clues[`clears_${suspect}`] = statement(witness(index), `${suspect} was elsewhere.`, asked(suspect, ["opening"]));
    conclusions[id] = { text: `${suspect} is cleared.`, rule: `clears_${suspect}`, clears: suspect };
  });
  if (witnessLie) {
    const [speaker] = witnesses;
    clues.alibi = statement(speaker, "Someone was with me.", { by: "first_meeting" }, { truth: false, why: "A favour." });
    clues.alibi_retracted = statement(speaker, "No one was with me.", gated({ use: { any: [first] } }), {
      takes_back: ["alibi"],
    });
  }
  if (alibi) conclusions.alibi_early = { text: "The alibi clears them.", rule: "alibi", clears: suspects[0] };
  for (let index = 0; index < extraGated; index++)
    clues[`extra_${index + 1}`] = statement(witness(witnesses.length - 1), `An aside ${index + 1}.`, gated({ use: { any: [first] } }), {
      colour: true,
    });

  const routes: Rule[] = ownClues.map((own) => ({
    all: [...sharedIds, own, ...(cleared ? [`${suspects[0]}_cleared`] : [])],
  }));
  conclusions.culprit_named = { text: "The culprit did it.", rule: { any: [...routes, ...(confessionRoute ? ["confession"] : [])] }, culprit: "culprit" };

  for (let index = Object.keys(clues).length; index < shape.clues; index++)
    clues[`colour_${index}`] = {
      kind: "tell",
      fact: `The culprit fidgets (${index}).`,
      source: { character: "culprit" },
      reached: { by: "seen", with: "confession" },
      colour: true,
    };

  const locations = Object.fromEntries(
    Array.from({ length: shape.locations }, (_, index) => [
      `place_${index}`,
      { name: `Place ${index}`, facts: [`Place ${index} is quiet.`], spots: index === 0 ? spots : [] },
    ]),
  );
  const characters = Object.fromEntries([
    ["culprit", person("Culprit", "culprit")],
    ...suspects.map((id) => [id, person(id, "suspect")]),
    ...witnesses.map((id) => [id, person(id, "witness")]),
  ]);
  return {
    format: "clue-graph/2",
    metadata: {
      id: "sized-fixture",
      title: "A Sized Case",
      time_budget: shape.time_budget,
      ...(size ? { size } : {}),
    },
    opening: { location: "place_0", facts: ["Something went missing."] },
    truth: { timeline: ["The culprit took it."], motive: "They wanted it." },
    locations,
    characters,
    clues,
    conclusions,
  };
}
