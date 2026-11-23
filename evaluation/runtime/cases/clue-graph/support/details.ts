// Spellings an accusation case accepts for what the engine handed its reply
// (`expect.handed`), shared by the stories. Each is a phrase that states the
// thing itself, taken from replies that did state it: a word a reply uses for
// anything else (a closing "where will you look next?", a crown that was
// "taken") would pass a reply that never said it.

/** That a statement was taken back. */
export const TAKEN_BACK = [
  "taken back", "took back", "takes back", "taking back", "took it back", "took that back", "taken that back", "took those words back", "took his words back",
  "taken those words back", "taken his words back", "taken her words back", "taken that story back", "taken his story back", "taken her story back",
  "no longer says", "no longer stands", "no longer counts", "no longer believes", "withdrawn", "changed his story", "changed her story", "changed his mind", "changed her mind",
];

/** The kind of fact a case needs: an account of who was where when it happened. */
export const WHO_WAS_WHERE = ["who was where", "where everyone was", "where was everyone", "where people were", "where each person was", "alibi", "alibis"];

/** The kind of fact a case needs: a physical finding that links someone to what happened. */
export const PHYSICAL_FINDING = [
  "physical", "touchable", "you can touch", "see or touch", "touch or see", "see and touch", "touch and see", "see or hold", "you can hold",
  "real object", "object or mark", "mark or object", "an object or a mark",
];
