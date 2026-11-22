/** Only public visual facts enter image prompts; clues and hidden truth never do. */
export function projectClueGraphArtwork(graph) {
  return {
    schema_version: "v2",
    id: graph.metadata.id,
    metadata: { ...graph.metadata, visual_direction: graph.visual_direction },
    narrative: { premise: graph.opening.facts.join(" ") },
    world: {
      starting_location_id: graph.opening.location,
      characters: Object.entries(graph.characters).map(([id, person]) => ({
        id,
        first_name: person.name,
        last_name: "",
        sex: person.sex,
        location_id: person.location,
        appearance: person.appearance.join(" "),
        personality: person.personality,
      })),
      locations: Object.entries(graph.locations).map(([id, place]) => ({
        id,
        name: place.name,
        description: place.facts.join(" "),
      })),
    },
    cover_image: {
      description: graph.cover?.facts.join(" ") ?? graph.metadata.title,
      character_ids: graph.cover?.characters ?? [],
      location_ids: graph.cover?.locations ?? [],
    },
  };
}
