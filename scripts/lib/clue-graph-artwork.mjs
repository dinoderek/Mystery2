/**
 * A clue-graph case's artwork view: what the image prompts read, under the
 * names they read it by. Only public visual facts enter image prompts; clues
 * and hidden truth never do. A character goes by one name.
 *
 * What a case's `cover` leaves out comes from the opening: its facts, every
 * character and the opening location, so the cover shows the case's own cast
 * rather than whatever its title suggests.
 */
export function projectClueGraphArtwork(graph) {
  return {
    id: graph.metadata.id,
    metadata: { title: graph.metadata.title, visual_direction: graph.visual_direction },
    world: {
      starting_location_id: graph.opening.location,
      characters: Object.entries(graph.characters).map(([id, person]) => ({
        id,
        name: person.name,
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
      description: (graph.cover?.facts ?? graph.opening.facts).join(" "),
      character_ids: graph.cover?.characters ?? Object.keys(graph.characters),
      location_ids: graph.cover?.locations ?? [graph.opening.location],
    },
  };
}
