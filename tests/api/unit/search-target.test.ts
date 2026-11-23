// Whether a targeted search names a spot, from the words alone: the engine
// decides it for a hidden spot the narrator is never shown
// (`clue-graph/narrator-context.ts`).

import { describe, expect, it } from "vitest";

import { searchNamesSpot } from "../../../packages/game-engine/src/search-target.ts";

describe("searchNamesSpot", () => {
  it("needs the spot's head word, not just a shared adjective", () => {
    expect(searchNamesSpot("search the dusty floor", "the dusty bookshelf", "Library")).toBe(false);
    expect(searchNamesSpot("check the muddy boots", "the pond's muddy edge", "Moonglow Pond")).toBe(false);
    expect(searchNamesSpot("search for snowshoes", "the snowshoe hooks out back", "Ticket Hut")).toBe(false);
    expect(searchNamesSpot("the dusty bookshelf", "the dusty bookshelf", "Library")).toBe(true);
  });

  it("folds plurals, a final -e or -y, and accents", () => {
    expect(searchNamesSpot("the cookies", "a stray cookie", "Kitchen")).toBe(true);
    expect(searchNamesSpot("the berry bush", "the berries bushes", "Garden")).toBe(true);
    expect(searchNamesSpot("the café counter", "the cafe counter", "Shop")).toBe(true);
  });

  it("matches the spot's own words, plurals included, at least half of them", () => {
    expect(searchNamesSpot("the hooks", "the snowshoe hooks out back", "Ticket Hut")).toBe(true);
    expect(searchNamesSpot("look under the willows", "under the weeping willow", "Moonglow Pond")).toBe(true);
    expect(searchNamesSpot("follow the fern path", "The Fading Fern Path", "Heartwood Hollow")).toBe(true);
    expect(searchNamesSpot("the ferns", "The Fading Fern Path", "Heartwood Hollow")).toBe(false);
  });

  it("names short nouns, but not short filler words", () => {
    expect(searchNamesSpot("under the bed", "under the bed", "Bedroom")).toBe(true);
    expect(searchNamesSpot("the rug", "the old rug", "Hall")).toBe(true);
    expect(searchNamesSpot("the tin box", "the tin box", "Shed")).toBe(true);
    expect(searchNamesSpot("look at the old one", "the old rug", "Hall")).toBe(false);
  });

  it("takes the thing before a position word as the head", () => {
    expect(searchNamesSpot("search the bench", "the bench under the big clock", "Station")).toBe(true);
    expect(searchNamesSpot("look at the big clock", "the bench under the big clock", "Station")).toBe(false);
    expect(searchNamesSpot("the cupboard", "the cupboard under the stairs", "Hall")).toBe(true);
    expect(searchNamesSpot("the stairs", "the cupboard under the stairs", "Hall")).toBe(false);
    expect(searchNamesSpot("the little room", "The Little Room Behind the Curtain", "Theatre")).toBe(true);
  });

  it("takes what a quantity word counts as the head", () => {
    expect(searchNamesSpot("the key hooks", "the row of key hooks", "Hut")).toBe(true);
    expect(searchNamesSpot("the lobster pots", "the stack of lobster pots", "Dock")).toBe(true);
    expect(searchNamesSpot("the trunks", "the tall stack of trunks", "Attic")).toBe(true);
    expect(searchNamesSpot("the row", "the row of key hooks", "Hut")).toBe(false);
  });

  it("takes the thing before a joining word as the head", () => {
    expect(searchNamesSpot("the shelf", "the shelf by the door", "Hall")).toBe(true);
    expect(searchNamesSpot("the door", "the shelf by the door", "Hall")).toBe(false);
    expect(searchNamesSpot("the letter box", "the box of letters", "Hall")).toBe(true);
  });

  it("ignores where-to-look words and the place's own name", () => {
    expect(searchNamesSpot("look behind it", "behind the big woodpile", "Woodshed")).toBe(false);
    expect(searchNamesSpot("search the pond", "the pond's muddy edge", "Moonglow Pond")).toBe(false);
    expect(searchNamesSpot("the muddy edge", "the pond's muddy edge", "Moonglow Pond")).toBe(true);
    expect(searchNamesSpot("anything", "under it", "Hut")).toBe(false);
  });
});
