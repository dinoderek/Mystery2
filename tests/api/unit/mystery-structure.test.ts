import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MysteryStructureSchema,
  validateMysteryStructure,
  type MysteryStructure,
  type MysteryStructureNode,
} from "@my2/shared";
import { createMysteryStructure } from "../../testkit/src/fixtures.ts";

function node<K extends MysteryStructureNode["kind"]>(
  mystery: MysteryStructure,
  id: string,
  kind: K,
) {
  const value = mystery.nodes[id];
  if (value.kind !== kind) throw new Error(`Expected ${kind}: ${id}`);
  return value as Extract<MysteryStructureNode, { kind: K }>;
}

function workedExample(): MysteryStructure {
  const markdown = fs.readFileSync("docs/mystery-structure.md", "utf8");
  const example = markdown.match(/```json\n([\s\S]*?)\n```/);
  if (!example) throw new Error("Missing documented example");
  return validateMysteryStructure(JSON.parse(example[1]));
}

function change(
  mystery: MysteryStructure,
  field: (string | number)[],
  value: unknown,
) {
  const parent = field
    .slice(0, -1)
    .reduce<object>((object, key) => Reflect.get(object, key), mystery);
  Reflect.set(parent, field.at(-1)!, value);
}

describe("Mystery Structure shape", () => {
  it("validates the documented case and exposes the schema and validator through shared", () => {
    const example = workedExample();
    expect(Object.keys(example.nodes)).toHaveLength(24);
    expect(MysteryStructureSchema.parse(example)).toEqual(example);
    expect(validateMysteryStructure(createMysteryStructure())).toEqual(
      createMysteryStructure(),
    );
  });

  it.each([
    [["$format"], "RUML"],
    [["$specVersion"], "0.2.0"],
    [["metadata", "revision"], 0],
    [["metadata", "target_age"], 1.5],
    [["metadata", "time_budget"], Infinity],
    [["metadata", "revision"], Number.MAX_SAFE_INTEGER + 1],
    [["metadata", "title"], "  "],
    [["metadata", "id"], ""],
    [["opening", "known_fact_ids"], null],
    [["solution", "event_ids"], []],
    [["solution", "rule_ids"], []],
    [["nodes", "solve", "operator"], "XOR"],
    [["nodes", "solve", "children"], []],
    [["nodes", "solve", "concludes_fact_ids"], []],
    [["nodes", "ada", "kind"], "suspect"],
    [["nodes", "note", "requires"], null],
    [
      ["nodes", "note", "requires"],
      { clue_ids: [], kind: "physical", rationale: "Locked." },
    ],
    [["nodes", "note", "source", "spot"], " "],
    [["nodes", "motive", "truth"], "true"],
    [
      ["nodes", "solve", "children"],
      ["note", "note"],
    ],
    [
      ["nodes", "motive", "about_ids"],
      ["ada", "ada"],
    ],
    [["metadata", "script"], "process.exit()"],
    [["nodes", "ada", "id"], "ada"],
    [["nodes", "note", "source", "url"], "https://example.com/"],
    [
      ["nodes", "note", "requires"],
      { clue_ids: ["note"], kind: "unknown", rationale: "Locked." },
    ],
    [["nodes", " "], { kind: "location", name: "Blank ID" }],
    [["extra"], true],
  ] as [Array<string | number>, unknown][])(
    "rejects malformed field %j",
    (field, value) => {
      const mystery = createMysteryStructure();
      change(mystery, field, value);
      expect(() => validateMysteryStructure(mystery)).toThrow(z.ZodError);
    },
  );

  it("rejects the prototype key instead of silently losing a node", () => {
    const mystery = createMysteryStructure();
    Object.defineProperty(mystery.nodes, "__proto__", {
      value: { kind: "location", name: "Attic" },
      enumerable: true,
    });
    expect(() => validateMysteryStructure(mystery)).toThrow("reserved");
  });

  it("preserves IDs exactly, including ordinary Object property names", () => {
    const mystery = createMysteryStructure();
    mystery.nodes[" toString "] = { kind: "location", name: "Attic" };
    mystery.opening.starting_location_id = " toString ";
    expect(validateMysteryStructure(mystery).opening.starting_location_id).toBe(
      " toString ",
    );
    expect(() =>
      validateMysteryStructure({
        ...mystery,
        opening: { ...mystery.opening, starting_location_id: "toString" },
      }),
    ).toThrow(/Reference.*toString/);
  });
});

describe("Mystery Structure integrity", () => {
  const references: [Array<string | number>, string | string[]][] = [
    [["opening", "starting_location_id"], "hall"],
    [["opening", "known_fact_ids"], ["motive"]],
    [["solution", "culprit_id"], "ada"],
    [["solution", "event_ids"], ["move"]],
    [["solution", "motive_fact_id"], "motive"],
    [["solution", "rule_ids"], ["solve"]],
    [["nodes", "ada", "location_id"], "hall"],
    [["nodes", "ada", "knows_fact_ids"], ["motive"]],
    [["nodes", "ada", "believes_claim_ids"], ["alibi"]],
    [["nodes", "move", "character_ids"], ["ada"]],
    [["nodes", "move", "location_id"], "store"],
    [["nodes", "move", "object_ids"], ["medal"]],
    [["nodes", "move", "after_event_ids"], ["leak"]],
    [["nodes", "move", "caused_by_event_ids"], ["leak"]],
    [["nodes", "motive", "about_ids"], ["ada"]],
    [["nodes", "alibi", "character_id"], "ada"],
    [["nodes", "alibi", "fact_id"], "ada_alibi"],
    [["nodes", "note", "source", "location_id"], "hall"],
    [["nodes", "denial", "source", "character_id"], "ada"],
    [["nodes", "note", "establishes_fact_ids"], ["motive"]],
    [["nodes", "denial", "reports_claim_ids"], ["alibi"]],
    [["nodes", "note", "origin_event_ids"], ["move"]],
    [["nodes", "cupboard", "requires", "clue_ids"], ["key"]],
    [["nodes", "solve", "children"], ["identify"]],
    [["nodes", "solve", "concludes_fact_ids"], ["motive"]],
    [["red_herrings", 0, "hypothesis_fact_id"], "ben_ink"],
    [["red_herrings", 0, "lead_clue_ids"], ["ink"]],
    [["red_herrings", 0, "resolution_rule_id"], "clear_ink"],
    [["eliminations", 0, "character_id"], "ben"],
    [["eliminations", 0, "rule_id"], "identify"],
  ];
  it.each(references)(
    "checks missing and wrong-kind references at %j",
    (field, valid) => {
      for (const invalid of ["missing", "toString", "alibi"]) {
        const mystery = workedExample();
        // A claim is a valid target for some fields; a location is wrong there.
        const target =
          valid === "alibi" || (Array.isArray(valid) && valid[0] === "alibi")
            ? invalid === "alibi"
              ? "hall"
              : invalid
            : invalid;
        change(mystery, field, Array.isArray(valid) ? [target] : target);
        try {
          validateMysteryStructure(mystery);
          expect.fail("Expected invalid reference");
        } catch (error) {
          expect(error).toHaveProperty(
            "issues",
            expect.arrayContaining([
              expect.objectContaining({
                path: Array.isArray(valid) ? [...field, 0] : field,
                message: expect.stringContaining(`Reference "${target}"`),
              }),
            ]),
          );
        }
      }
    },
  );

  it("keeps shape checks separate and never mutates a caller's document", () => {
    const mystery = createMysteryStructure();
    const before = structuredClone(mystery);
    validateMysteryStructure(mystery);
    expect(mystery).toEqual(before);
    mystery.opening.starting_location_id = "missing";
    expect(MysteryStructureSchema.safeParse(mystery).success).toBe(true);
    expect(() => validateMysteryStructure(mystery)).toThrow(
      "existing location",
    );
  });

  it.each(["event", "clue", "rule"] as const)(
    "rejects self references and cycles in %s graphs",
    (kind) => {
      const mystery = workedExample();
      if (kind === "event")
        node(mystery, "leak", "event").after_event_ids = ["move"];
      if (kind === "clue")
        node(mystery, "key", "clue").requires = {
          clue_ids: ["cupboard"],
          kind: "knowledge",
          rationale: "Circular.",
        };
      if (kind === "rule")
        node(mystery, "identify", "rule").children = ["solve"];
      expect(() => validateMysteryStructure(mystery)).toThrow("cycle");
      if (kind === "event")
        node(mystery, "leak", "event").after_event_ids = ["leak"];
      if (kind === "clue")
        node(mystery, "key", "clue").requires!.clue_ids = ["key"];
      if (kind === "rule")
        node(mystery, "identify", "rule").children = ["identify"];
      expect(() => validateMysteryStructure(mystery)).toThrow("cycle");
    },
  );

  it("checks ordering and includes causal and temporal ancestors in the solution timeline", () => {
    const mystery = workedExample();
    mystery.solution.event_ids.reverse();
    expect(() => validateMysteryStructure(mystery)).toThrow(
      "must occur before",
    );
    mystery.solution.event_ids = ["move"];
    expect(() => validateMysteryStructure(mystery)).toThrow(/Event.*leak/);
    mystery.solution.event_ids = ["leak", "move"];
    node(mystery, "move", "event").after_event_ids = ["leak"];
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
  });

  it.each([
    [["opening", "known_fact_ids"], ["ben_moved"]],
    [["solution", "motive_fact_id"], "ben_moved"],
    [["nodes", "solve", "concludes_fact_ids"], ["stored"]],
    [["nodes", "solve", "concludes_fact_ids"], ["motive"]],
    [["red_herrings", 0, "hypothesis_fact_id"], "stored"],
    [["red_herrings", 0, "resolution_rule_id"], "solve"],
    [["eliminations", 0, "character_id"], "ada"],
    [["eliminations", 0, "rule_id"], "solve"],
  ] as [Array<string | number>, unknown][])(
    "rejects inconsistent conclusions at %j",
    (field, value) => {
      const mystery = workedExample();
      // This field needs a true conclusion that actually links culprit and incident.
      if (
        field.join(".") === "nodes.solve.concludes_fact_ids" &&
        Array.isArray(value) &&
        value[0] === "motive"
      )
        node(mystery, "motive", "fact").about_ids = ["medal"];
      change(mystery, field, value);
      expect(() => validateMysteryStructure(mystery)).toThrow();
    },
  );

  it("rejects duplicate eliminations and accepts explicit false knowledge and mistaken beliefs", () => {
    const mystery = workedExample();
    mystery.eliminations.push({ ...mystery.eliminations[0] });
    expect(() => validateMysteryStructure(mystery)).toThrow(
      "distinct non-culprit",
    );
    mystery.eliminations.pop();
    node(mystery, "ben", "character").believes_claim_ids = ["alibi"];
    mystery.opening.known_fact_ids = ["stored"];
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
  });
});

describe("Mystery Structure solvability", () => {
  it("counts prerequisites, travel and searches, with the last affordable search included", () => {
    const mystery = workedExample();
    mystery.metadata.time_budget = 4;
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
    mystery.metadata.time_budget = 3;
    expect(() => validateMysteryStructure(mystery)).toThrow("turn budget");
  });

  it("supports OR, alternative winning rules and shared clues without double charging", () => {
    const mystery = createMysteryStructure();
    mystery.nodes.alternative = {
      ...node(mystery, "solve", "rule"),
      children: ["note"],
    };
    node(mystery, "solve", "rule").operator = "OR";
    node(mystery, "solve", "rule").children = ["note", "alternative"];
    mystery.metadata.time_budget = 1;
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
    node(mystery, "solve", "rule").operator = "AND";
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
    mystery.solution.rule_ids = ["alternative", "solve"];
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
  });

  it("charges one conversation for several clues and recharges after an intervening search", () => {
    const mystery = createMysteryStructure();
    node(mystery, "note", "clue").source = {
      kind: "talk",
      character_id: "ada",
    };
    mystery.nodes.second = { ...node(mystery, "note", "clue") };
    node(mystery, "solve", "rule").children = ["note", "second"];
    mystery.metadata.time_budget = 1;
    expect(() => validateMysteryStructure(mystery)).toThrow("turn budget");
    mystery.metadata.time_budget = 2;
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
    mystery.nodes.key = {
      ...node(mystery, "note", "clue"),
      source: { kind: "search", location_id: "hall" },
      requires: {
        clue_ids: ["note"],
        kind: "knowledge",
        rationale: "A direction.",
      },
    };
    node(mystery, "second", "clue").requires = {
      clue_ids: ["key"],
      kind: "social",
      rationale: "Bring the key.",
    };
    mystery.metadata.time_budget = 4;
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
    mystery.metadata.time_budget = 3;
    expect(() => validateMysteryStructure(mystery)).toThrow("turn budget");
  });

  it("counts revisits forced by prerequisites and does not assume a clever bypass", () => {
    const mystery = createMysteryStructure();
    mystery.nodes.store = { kind: "location", name: "Store" };
    node(mystery, "ada", "character").location_id = "store";
    mystery.nodes.direction = {
      ...node(mystery, "note", "clue"),
      source: { kind: "talk", character_id: "ada" },
    };
    node(mystery, "note", "clue").requires = {
      clue_ids: ["direction"],
      kind: "knowledge",
      rationale: "Find out where to look.",
    };
    mystery.metadata.time_budget = 4;
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
    mystery.metadata.time_budget = 3;
    expect(() => validateMysteryStructure(mystery)).toThrow("turn budget");
  });

  it("handles more than 32 clues and prunes an impossible large mandatory set", () => {
    const mystery = createMysteryStructure();
    const clues = Array.from({ length: 40 }, (_, index) => `clue-${index}`);
    for (const id of clues)
      mystery.nodes[id] = { ...node(mystery, "note", "clue") };
    node(mystery, "solve", "rule").children = clues;
    mystery.metadata.time_budget = 39;
    expect(() => validateMysteryStructure(mystery)).toThrow("turn budget");
    mystery.metadata.time_budget = 40;
    expect(validateMysteryStructure(mystery)).toEqual(mystery);
  });
});

describe("Mystery Structure command", () => {
  function run(args: string[]) {
    return spawnSync(
      process.execPath,
      ["scripts/validate-mystery-structure.mjs", ...args],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
  }

  it("validates a JSON file and reports field paths, parse/read failures and usage separately", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-structure-"));
    const file = path.join(dir, "case.json");
    try {
      fs.writeFileSync(file, JSON.stringify(workedExample()));
      expect(run([file])).toMatchObject({
        status: 0,
        stdout: expect.stringContaining("OK:"),
      });
      fs.writeFileSync(
        file,
        JSON.stringify({ ...createMysteryStructure(), $specVersion: "99" }),
      );
      expect(run([file])).toMatchObject({
        status: 1,
        stderr: expect.stringContaining("$specVersion"),
      });
      fs.writeFileSync(file, "{");
      expect(run([file])).toMatchObject({
        status: 2,
        stderr: expect.stringContaining(file),
      });
      const bytes = Buffer.from(JSON.stringify(createMysteryStructure()));
      bytes[bytes.indexOf("The Medal")] = 0xff;
      fs.writeFileSync(file, bytes);
      expect(run([file])).toMatchObject({
        status: 2,
        stderr: expect.stringContaining("utf-8"),
      });
      expect(run([path.join(dir, "missing.json")])).toMatchObject({
        status: 2,
        stderr: expect.stringContaining("ENOENT"),
      });
      expect(run([])).toMatchObject({
        status: 3,
        stderr: expect.stringContaining("usage:"),
      });
      expect(run([file, "extra"])).toMatchObject({ status: 3 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate keys, including escaped spellings, without mistaking quoted prose for keys", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-structure-"));
    const file = path.join(dir, "case.json");
    try {
      const mystery = createMysteryStructure();
      node(mystery, "note", "clue").text =
        'She said: "nodes": [ { "text": "clue" } ]';
      fs.writeFileSync(file, JSON.stringify(mystery));
      expect(run([file]).status).toBe(0);
      fs.writeFileSync(file, '{"nodes": {}, "no\\u0064es": {}}');
      expect(run([file])).toMatchObject({
        status: 2,
        stderr: expect.stringContaining('Duplicate JSON key "nodes"'),
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
