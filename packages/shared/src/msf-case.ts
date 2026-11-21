import { z } from "zod";
import {
  BlueprintV2Schema,
  BlueprintV2CharacterSchema,
  BlueprintV2LocationSchema,
  BlueprintV2SubLocationSchema,
  type BlueprintV2,
} from "./blueprint-schema-v2.ts";
import type { ClueGraphCase } from "./clue-graph-schema.ts";
import { MysteryStructureSchema } from "./mystery-structure-schema.ts";
import { validateMysteryStructure } from "./mystery-structure-validator.ts";

const fields = BlueprintV2Schema.innerType().shape;
const location = BlueprintV2LocationSchema.pick({
  id: true,
  description: true,
  location_image_id: true,
})
  .extend({
    sub_locations: z.array(
      BlueprintV2SubLocationSchema.pick({
        id: true,
        name: true,
        hint: true,
      }).strict(),
    ),
  })
  .strict();
const character = BlueprintV2CharacterSchema.pick({
  id: true,
  first_name: true,
  last_name: true,
  sex: true,
  appearance: true,
  personality: true,
  initial_attitude_towards_investigator: true,
  portrait_image_id: true,
}).strict();

/** Presentation is deliberately unable to supply clues, knowledge, truth or reasoning paths. */
export const MsfCaseFileSchema = z
  .object({
    $format: z.literal("MSF-CASE/1"),
    paired_blueprint_id: z.string().uuid(),
    structure: MysteryStructureSchema,
    presentation: z
      .object({
        metadata: fields.metadata
          .pick({
            one_liner: true,
            narration_style: true,
            image_id: true,
            visual_direction: true,
          })
          .strict(),
        starting_knowledge: fields.narrative.shape.starting_knowledge,
        locations: z.array(location),
        characters: z.array(character),
        cover_image: fields.cover_image,
      })
      .strict(),
  })
  .strict();

export type MsfCaseFile = z.infer<typeof MsfCaseFileSchema>;
/** Shared world view for commands/artwork; MSF and clue-graph rules and knowledge retain their native graph. */
export type PlayableBlueprint = Omit<BlueprintV2, "schema_version"> & {
  schema_version: "v2" | "msf/0.1.0" | "clue-graph/1";
  msf?: MsfCaseFile;
  clue_graph?: ClueGraphCase;
  representation_note?: string;
};

export function validateMsfCaseFile(value: unknown): MsfCaseFile {
  const file = MsfCaseFileSchema.parse(value);
  file.structure = validateMysteryStructure(file.structure);
  z.string().uuid().parse(file.structure.metadata.id);
  if (file.structure.metadata.id === file.paired_blueprint_id)
    throw new Error("An MSF alternative needs its own case id");
  for (const kind of ["location", "character"] as const) {
    const entries =
      kind === "location"
        ? file.presentation.locations
        : file.presentation.characters;
    const ids = new Set(entries.map((entry) => entry.id));
    const expected = Object.entries(file.structure.nodes)
      .filter(([, node]) => node.kind === kind)
      .map(([id]) => id);
    if (
      ids.size !== entries.length ||
      ids.size !== expected.length ||
      expected.some((id) => !ids.has(id))
    )
      throw new Error(`MSF ${kind} presentation must match graph IDs exactly`);
  }
  for (const node of Object.values(file.structure.nodes)) {
    if (
      node.kind !== "clue" ||
      node.source.kind !== "search" ||
      !node.source.spot
    )
      continue;
    const source = node.source;
    const place = file.presentation.locations.find(
      (entry) => entry.id === source.location_id,
    );
    if (!place?.sub_locations.some((spot) => spot.name === source.spot))
      throw new Error(`Unknown MSF search spot: ${source.spot}`);
  }
  return file;
}

export function buildMsfBlueprint(file: MsfCaseFile): PlayableBlueprint {
  const { structure, presentation } = file;
  const nodes = Object.entries(structure.nodes);
  const clues = nodes.flatMap(([id, node]) =>
    node.kind === "clue" ? [{ id, ...node }] : [],
  );
  const project = (clue: (typeof clues)[number]) => ({
    id: clue.id,
    text: clue.text,
    ...(clue.requires
      ? {
          requires: {
            kind:
              clue.requires.kind === "physical"
                ? ("pointer" as const)
                : ("leverage" as const),
            clue_ids: clue.requires.clue_ids,
            rationale: clue.requires.rationale,
          },
        }
      : {}),
  });
  const locations = presentation.locations.map((place) => {
    const node = structure.nodes[place.id];
    if (node.kind !== "location")
      throw new Error(`Expected MSF location ${place.id}`);
    const at = clues.filter(
      (clue) =>
        clue.source.kind === "search" && clue.source.location_id === place.id,
    );
    return {
      ...place,
      name: node.name,
      clues: at
        .filter((clue) => clue.source.kind === "search" && !clue.source.spot)
        .map(project),
      sub_locations: place.sub_locations.map((spot) => ({
        ...spot,
        clues: at
          .filter(
            (clue) =>
              clue.source.kind === "search" && clue.source.spot === spot.name,
          )
          .map(project),
      })),
    };
  });
  const characters = presentation.characters.map((face) => {
    const node = structure.nodes[face.id];
    if (node.kind !== "character")
      throw new Error(`Expected MSF character ${face.id}`);
    return {
      ...face,
      location_id: node.location_id,
      background: "",
      stated_alibi: null,
      motive: null,
      is_culprit: face.id === structure.solution.culprit_id,
      clues: clues
        .filter(
          (clue) =>
            clue.source.kind === "talk" && clue.source.character_id === face.id,
        )
        .map(project),
      flavor_knowledge: [],
      actual_actions: [],
      agendas: [],
      tells: [],
    };
  });
  const timeline = structure.solution.event_ids.map((id) => {
    const node = structure.nodes[id];
    if (node.kind !== "event") throw new Error(`Expected MSF event ${id}`);
    return node.text;
  });
  const motive = structure.nodes[structure.solution.motive_fact_id];
  if (motive.kind !== "fact") throw new Error("Expected MSF motive fact");
  return {
    schema_version: "msf/0.1.0",
    id: structure.metadata.id,
    msf: file,
    representation_note:
      "This case runs native MSF: msf.structure is authoritative for facts, character knowledge/claims, physical/social/knowledge gates and AND/OR deductions. The world is a presentation/source projection; legacy reasoning-path arrays are deliberately empty. Judge against the graph, not the absence of V2 agendas/actions. Claims are statements, not proof of their contents; truth:false denies a proposition. Recorded clue IDs, off-script reveals and accusation rules retain their usual meaning.",
    metadata: {
      ...presentation.metadata,
      ...structure.metadata,
      title: `${structure.metadata.title} — MSF experiment`,
    },
    narrative: {
      premise: structure.opening.premise,
      starting_knowledge: presentation.starting_knowledge,
    },
    world: {
      starting_location_id: structure.opening.starting_location_id,
      locations,
      characters,
    },
    cover_image: presentation.cover_image,
    ground_truth: {
      what_happened: timeline.join("\n"),
      why_it_happened: motive.text,
      timeline,
    },
    // Legacy path lists must never replace AND/OR inference in the native graph.
    solution_paths: [],
    red_herrings: [],
    suspect_elimination_paths: [],
  };
}
