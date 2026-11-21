import type { ClueGraphCase } from "./clue-graph-schema.ts";
import type { PlayableBlueprint } from "./msf-case.ts";

/** What the catalog adds to a clue-graph case's title, to tell it from a V2 case of the same story. */
export const CLUE_GRAPH_TITLE_SUFFIX = " — clue graph";

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The catalog ID of a clue-graph case. The API names cases by UUID and a case
 * file by its kebab-case `metadata.id`, so the UUID is derived from that ID:
 * the same on every machine and every run (a version 8 UUID).
 */
export function clueGraphCaseId(caseId: string): string {
  const hex = [0, 1, 2, 3].map((lane) => fnv1a(`${lane}:${caseId}`).toString(16).padStart(8, "0")).join("");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The ID a spot goes by in the world view: its name, kebab-cased. Spot names are unique per location. */
export function spotIdOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The world view the commands, arrivals, notebook and artwork read, built from
 * a validated clue-graph case. It carries no rules: talk, search and the judge
 * read `clue_graph`, which stays authoritative. A hidden spot's clue points at
 * the spot's `revealed_by`, so an arrival does not mention the spot before it.
 */
export function buildClueGraphBlueprint(graph: ClueGraphCase): PlayableBlueprint {
  const evidence = Object.entries(graph.clues).flatMap(([id, clue]) =>
    clue.kind === "evidence" ? [{ id, text: clue.text, source: clue.source }] : [],
  );
  const locations = Object.entries(graph.locations).map(([id, place]) => ({
    id,
    name: place.name,
    description: place.description,
    clues: evidence
      .filter((clue) => clue.source.location === id && clue.source.spot === undefined)
      .map(({ id: clueId, text }) => ({ id: clueId, text })),
    sub_locations: place.spots.map((spot) => ({
      id: spotIdOf(spot.name),
      name: spot.name,
      hint: spot.name,
      clues: evidence
        .filter((clue) => clue.source.location === id && clue.source.spot === spot.name)
        .map(({ id: clueId, text }) => ({
          id: clueId,
          text,
          ...(spot.revealed_by
            ? {
                requires: {
                  kind: "pointer" as const,
                  clue_ids: [spot.revealed_by],
                  rationale: "A hidden spot shows once its pointer is held.",
                },
              }
            : {}),
        })),
    })),
  }));
  const characters = Object.entries(graph.characters).map(([id, person]) => ({
    id,
    // One name, as the case writes it: "talk to Ms. Hale".
    first_name: person.name,
    last_name: "",
    location_id: person.location,
    sex: person.sex,
    appearance: "",
    background: "",
    personality: person.personality,
    initial_attitude_towards_investigator: Object.values(person.demeanor).find(Boolean) ?? "",
    stated_alibi: null,
    motive: null,
    is_culprit: person.role === "culprit",
    clues: Object.entries(graph.clues).flatMap(([clueId, clue]) =>
      clue.kind !== "evidence" && clue.source.character === id ? [{ id: clueId, text: clue.text }] : [],
    ),
    flavor_knowledge: [],
    actual_actions: [],
    agendas: [],
    tells: [],
  }));
  const culprit = Object.values(graph.conclusions).find((conclusion) => conclusion.culprit);
  const { timeline } = graph.truth;
  return {
    schema_version: "clue-graph/1",
    id: clueGraphCaseId(graph.metadata.id),
    clue_graph: graph,
    representation_note:
      "This case is a clue graph: clue_graph is authoritative for clues, gates, retractions and the AND/OR conclusions. The world is a projection for commands and artwork; legacy reasoning-path arrays are deliberately empty. A statement is what a character said, true or false; one taken back no longer stands.",
    metadata: {
      title: `${graph.metadata.title}${CLUE_GRAPH_TITLE_SUFFIX}`,
      one_liner: graph.opening.text[0],
      target_age: graph.metadata.target_age,
      time_budget: graph.metadata.time_budget,
    },
    narrative: {
      premise: graph.opening.text.join(" "),
      starting_knowledge: {
        mystery_summary: graph.opening.text[0],
        locations: [],
        characters: [],
      },
    },
    world: { starting_location_id: graph.opening.location, locations, characters },
    cover_image: { description: graph.metadata.title, location_ids: [], character_ids: [] },
    ground_truth: {
      what_happened: timeline.join("\n"),
      why_it_happened: culprit?.text ?? timeline.at(-1)!,
      timeline,
    },
    solution_paths: [],
    red_herrings: [],
    suspect_elimination_paths: [],
  };
}
