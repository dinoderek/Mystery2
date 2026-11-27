// How a judge family's prompts are stored: a field every judge is sent alike is
// kept once, and anything that differs stays in each judge's own file, so a
// change to one judge's payload still changes a stored file.

import { describe, expect, it } from "vitest";

import { promptSnapshot, SHARED, type PromptParts } from "./eval-snapshot-store.ts";

function judge(dimension: string, fields: Record<string, unknown>): PromptParts {
  return { system: `brief ${dimension}`, user: JSON.stringify({ dimension_id: dimension, ...fields }) };
}

const CASE = { suspects: ["leo", "nina"] };

describe("promptSnapshot", () => {
  it("keeps a field every judge of a family is sent alike once, in the family's file", () => {
    const sent = new Map([
      ["fam.a", judge("a", { context: null, case: CASE })],
      ["fam.b", judge("b", { context: null, case: CASE, extra: { b: 1 } })],
    ]);
    const { own, shared } = promptSnapshot(sent);

    expect(Object.keys(shared)).toEqual(["prompts/fam.shared.json"]);
    expect(JSON.parse(shared["prompts/fam.shared.json"])).toEqual({ case: CASE });
    expect(JSON.parse(own.get("fam.a")!["prompts/fam.a.user.json"])).toEqual({ dimension_id: "a", context: null, case: SHARED });
    // The judge's own fields stay where they were sent, after the shared one.
    expect(Object.keys(JSON.parse(own.get("fam.b")!["prompts/fam.b.user.json"]))).toEqual(["dimension_id", "context", "case", "extra"]);
    // Putting the shared fields back gives the bytes that were sent.
    const common = JSON.parse(shared["prompts/fam.shared.json"]);
    for (const [id, parts] of sent) {
      const kept = JSON.parse(own.get(id)![`prompts/${id}.user.json`]) as Record<string, unknown>;
      const rebuilt = Object.fromEntries(Object.entries(kept).map(([key, value]) => [key, value === SHARED ? common[key] : value]));
      expect(JSON.stringify(rebuilt)).toBe(parts.user);
    }
  });

  it("keeps a field one judge is sent differently in every judge's own file", () => {
    const { own, shared } = promptSnapshot(
      new Map([
        ["fam.a", judge("a", { case: CASE })],
        ["fam.b", judge("b", { case: { ...CASE, culprit: "leo" } })],
      ]),
    );

    expect(shared).toEqual({});
    expect(JSON.parse(own.get("fam.a")!["prompts/fam.a.user.json"]).case).toEqual(CASE);
    expect(JSON.parse(own.get("fam.b")!["prompts/fam.b.user.json"]).case).toEqual({ ...CASE, culprit: "leo" });
  });

  it("shares nothing for a judge alone in its family, or a message that is not a judge's", () => {
    const { own, shared } = promptSnapshot(
      new Map([
        ["solo.a", judge("a", { case: CASE })],
        ["fam.turn", { system: "s", user: JSON.stringify({ case: CASE }) }],
        ["fam.prose", { system: "s", user: "plain text" }],
      ]),
    );

    expect(shared).toEqual({});
    expect(JSON.parse(own.get("solo.a")!["prompts/solo.a.user.json"]).case).toEqual(CASE);
    expect(own.get("fam.prose")).toEqual({ "prompts/fam.prose.system.txt": "s", "prompts/fam.prose.user.txt": "plain text" });
  });

  it("refuses a judge whose dimension_id is not the last part of its prompt id", () => {
    expect(() => promptSnapshot(new Map([["fam.a", judge("b", {})]]))).toThrow(/fam\.a was sent dimension_id "b"/);
  });
});
