import { CLUE_GRAPH_FORMAT, type ClueGraphCase } from "./clue-graph-schema.ts";

/** What the catalog adds to a clue-graph case's title. */
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

/** A clue as the world view lists it: the clue graph's fact, under the clue's ID. */
export interface ClueGraphWorldClue {
  id: string;
  text: string;
  /** On a hidden spot's clue: the spot shows once its `revealed_by` clue is held. */
  requires?: { kind: "pointer"; clue_ids: string[]; rationale: string };
}

export interface ClueGraphWorldSpot {
  id: string;
  name: string;
  hint: string;
  clues: ClueGraphWorldClue[];
}

export interface ClueGraphWorldLocation {
  id: string;
  name: string;
  description: string;
  location_image_id?: string;
  /** Evidence found by searching the place itself, not one of its spots. */
  clues: ClueGraphWorldClue[];
  sub_locations: ClueGraphWorldSpot[];
}

export interface ClueGraphWorldCharacter {
  id: string;
  /** The character's one name, as the case writes it: "talk to Ms. Hale". */
  first_name: string;
  location_id: string;
  sex: "male" | "female";
  appearance: string;
  portrait_image_id?: string;
  personality: string;
  initial_attitude_towards_investigator: string;
  is_culprit: boolean;
  /** Every statement and tell the character holds; the graph says when each comes out. */
  clues: ClueGraphWorldClue[];
}

/**
 * The world view the commands, arrivals, notebook and artwork read, built from
 * a validated clue-graph case. It carries no rules: talk, search and the judge
 * read `clue_graph`, which stays authoritative.
 */
export interface ClueGraphWorld {
  schema_version: typeof CLUE_GRAPH_FORMAT;
  id: string;
  clue_graph: ClueGraphCase;
  representation_note: string;
  metadata: {
    title: string;
    one_liner: string;
    image_id?: string;
    time_budget: number;
    visual_direction?: ClueGraphCase["visual_direction"];
  };
  narrative: { premise: string; starting_knowledge: { mystery_summary: string } };
  world: {
    starting_location_id: string;
    locations: ClueGraphWorldLocation[];
    characters: ClueGraphWorldCharacter[];
  };
  cover_image: { description: string; location_ids: string[]; character_ids: string[] };
  ground_truth: { what_happened: string; why_it_happened: string; timeline: string[] };
}

/**
 * Builds the world view of a validated clue-graph case. A hidden spot's clue
 * points at the spot's `revealed_by`, so an arrival does not mention the spot
 * before it.
 */
export function buildClueGraphWorld(graph: ClueGraphCase): ClueGraphWorld {
  const evidence = Object.entries(graph.clues).flatMap(([id, clue]) =>
    clue.kind === "evidence" ? [{ id, text: clue.fact, source: clue.source }] : [],
  );
  const locations = Object.entries(graph.locations).map(([id, place]): ClueGraphWorldLocation => ({
    id,
    name: place.name,
    description: place.facts.join(" "),
    ...(place.location_image_id ? { location_image_id: place.location_image_id } : {}),
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
  const characters = Object.entries(graph.characters).map(([id, person]): ClueGraphWorldCharacter => ({
    id,
    first_name: person.name,
    location_id: person.location,
    sex: person.sex,
    appearance: person.appearance.join(" "),
    ...(person.portrait_image_id ? { portrait_image_id: person.portrait_image_id } : {}),
    personality: person.personality,
    initial_attitude_towards_investigator: Object.values(person.demeanor).find(Boolean) ?? "",
    is_culprit: person.role === "culprit",
    clues: Object.entries(graph.clues).flatMap(([clueId, clue]) =>
      clue.kind !== "evidence" && clue.source.character === id ? [{ id: clueId, text: clue.fact }] : [],
    ),
  }));
  const { timeline } = graph.truth;
  return {
    schema_version: CLUE_GRAPH_FORMAT,
    id: clueGraphCaseId(graph.metadata.id),
    clue_graph: graph,
    representation_note:
      "This case is a clue graph: clue_graph is authoritative for clues, gates, retractions and the AND/OR conclusions. The world is a projection for commands and artwork; legacy reasoning-path arrays are deliberately empty. A statement is what a character said, true or false; one taken back no longer stands.",
    metadata: {
      title: `${graph.metadata.title}${CLUE_GRAPH_TITLE_SUFFIX}`,
      one_liner: graph.opening.facts[0],
      ...(graph.metadata.image_id ? { image_id: graph.metadata.image_id } : {}),
      time_budget: graph.metadata.time_budget,
      ...(graph.visual_direction ? { visual_direction: graph.visual_direction } : {}),
    },
    narrative: {
      premise: graph.opening.facts.join(" "),
      starting_knowledge: { mystery_summary: graph.opening.facts[0] },
    },
    world: { starting_location_id: graph.opening.location, locations, characters },
    cover_image: {
      description: graph.cover?.facts.join(" ") ?? graph.metadata.title,
      location_ids: graph.cover?.locations ?? [],
      character_ids: graph.cover?.characters ?? [],
    },
    ground_truth: {
      what_happened: timeline.join("\n"),
      why_it_happened: graph.truth.motive,
      timeline,
    },
  };
}
