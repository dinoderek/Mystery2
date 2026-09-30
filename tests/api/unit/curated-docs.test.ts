import { describe, expect, it } from "vitest";

import {
  parsePins,
  parseSections,
  sectionHash,
  splitPin,
} from "../../../evaluation/generator-harness/scripts/curated-docs.mjs";

/**
 * A curated extract is only as honest as its pins. The properties worth holding
 * are that a pin notices a change to the words it covers, and only those: an
 * edit elsewhere in the doc, or a re-wrap, must not send anyone to re-review an
 * extract that is still true.
 */

const SHA = "a".repeat(40);

const doc = (body: string) =>
  ["# Title", "", "Intro.", "", "<!-- extract:rules -->", body, "<!-- /extract:rules -->", "", "Outro."].join(
    "\n",
  );

const hashOfRules = (text: string) => sectionHash(parseSections(text).sections.get("rules"));

describe("splitPin", () => {
  it("separates a section from its file", () => {
    expect(splitPin("docs/game.md#commands")).toEqual({ path: "docs/game.md", section: "commands" });
    expect(splitPin("src/story-brief.ts")).toEqual({ path: "src/story-brief.ts", section: null });
  });
});

describe("parsePins", () => {
  it("reads list pins, with and without a section", () => {
    const header = [
      "> Pinned sources:",
      `> - \`docs/game.md#commands\` — \`${SHA}\``,
      `> - \`packages/x/story-brief.ts\` — \`${"b".repeat(40)}\``,
    ].join("\n");
    expect(parsePins(header)).toEqual([
      { path: "docs/game.md", section: "commands", pin: "docs/game.md#commands", expected: SHA },
      { path: "packages/x/story-brief.ts", section: null, pin: "packages/x/story-brief.ts", expected: "b".repeat(40) },
    ]);
  });

  it("reads the single-source form alongside list pins", () => {
    const header = [
      "> Source: `docs/game.md`",
      `> Source git blob hash: \`${SHA}\``,
      `> - \`docs/other.md\` — \`${"c".repeat(40)}\``,
    ].join("\n");
    expect(parsePins(header).map((p) => p.pin)).toEqual(["docs/other.md", "docs/game.md"]);
  });
});

describe("section hashing", () => {
  const original = doc("Talking costs one turn.\nQuestions are free.");

  it("ignores edits outside the section", () => {
    const edited = original.replace("Intro.", "A rewritten introduction.");
    expect(hashOfRules(edited)).toBe(hashOfRules(original));
  });

  it("ignores re-wrapping inside the section", () => {
    const rewrapped = doc("Talking costs\none turn. Questions   are free.");
    expect(hashOfRules(rewrapped)).toBe(hashOfRules(original));
  });

  it("notices a changed word inside the section", () => {
    const edited = doc("Talking costs two turns.\nQuestions are free.");
    expect(hashOfRules(edited)).not.toBe(hashOfRules(original));
  });

  it("ignores a nested marker, so adding a section does not drift its parent", () => {
    const nested = doc("<!-- extract:inner -->\nTalking costs one turn.\n<!-- /extract:inner -->\nQuestions are free.");
    expect(hashOfRules(nested)).toBe(hashOfRules(original));
    expect(parseSections(nested).sections.has("inner")).toBe(true);
  });
});

describe("parseSections", () => {
  it("reports markers it cannot pair", () => {
    const text = [
      "<!-- extract:a -->",
      "<!-- extract:a -->",
      "<!-- /extract:b -->",
      "<!-- extract:c -->",
      "<!-- /extract:a -->",
    ].join("\n");
    expect(parseSections(text).errors).toEqual([
      'section "a" is opened more than once',
      'section "b" is closed without being opened',
      'section "c" is never closed',
    ]);
  });
});
