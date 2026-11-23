/**
 * A clue-graph case's artwork view: what the image prompts read, under the
 * names they read it by. Only public visual facts enter image prompts; clues
 * and hidden truth never do. A character goes by one name.
 */
export function projectClueGraphArtwork(graph) {
  return {
    format: graph.format,
    id: graph.metadata.id,
    metadata: { ...graph.metadata, visual_direction: graph.visual_direction },
    narrative: { premise: graph.opening.facts.join(" ") },
    world: {
      starting_location_id: graph.opening.location,
      characters: Object.entries(graph.characters).map(([id, person]) => ({
        id,
        first_name: person.name,
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
