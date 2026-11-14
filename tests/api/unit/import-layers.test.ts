import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  compareToBaseline,
  describeDiff,
  findViolations,
} from "../../../scripts/lib/check-imports.mjs";

let dir: string;

function write(file: string, text = "export const x = 1;\n") {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

/** The rule names a file breaks, from the violation keys. */
function rulesBrokenBy(violations: string[], from: string) {
  return violations
    .filter((key) => key.includes(`: ${from} -> `))
    .map((key) => key.split(":")[0])
    .sort();
}

describe("import-layer rules", () => {
  let violations: string[];

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "import-layers-"));
    // The driver, as a package in the fixture's own node_modules.
    write(
      "node_modules/better-sqlite3/package.json",
      '{"name":"better-sqlite3","main":"index.js"}',
    );
    write("node_modules/better-sqlite3/index.js", "module.exports = {};\n");

    write("packages/shared/src/ok.ts");
    write(
      "packages/shared/src/reaches-engine.ts",
      'import "../../game-engine/src/index.ts";\n',
    );
    write("packages/game-engine/src/index.ts");
    write(
      "packages/game-engine/src/reaches-web.ts",
      'import "../../../web/src/lib/domain/d.ts";\n',
    );
    write(
      "packages/game-engine/src/uses-shared.ts",
      'import "../../shared/src/ok.ts";\n',
    );
    write(
      "packages/game-engine/src/db/client.ts",
      'import "better-sqlite3";\n',
    );
    write("packages/game-engine/src/db/other.ts", 'import "./client.ts";\n');
    write(
      "packages/game-engine/src/context-local.ts",
      'import "./db/client.ts";\n',
    );
    write(
      "packages/game-engine/src/endpoints/e.ts",
      'import "../db/other.ts";\nimport "better-sqlite3";\n',
    );
    write("packages/game-engine/src/ring-a.ts", 'import "./ring-b.ts";\n');
    write("packages/game-engine/src/ring-b.ts", 'import "./ring-a.ts";\n');
    write("web/src/lib/server/s.ts");
    write("web/src/lib/components/c.ts");
    write("web/src/lib/domain/d.ts", 'import "../components/c.ts";\n');
    write(
      "web/src/lib/browser.ts",
      'import "$lib/server/s";\nimport "../../../packages/game-engine/src/index.ts";\n',
    );
    write(
      "web/src/routes/api/+server.ts",
      'import "$lib/server/s";\nimport "../../../../packages/game-engine/src/index.ts";\n',
    );
    write("web/src/hooks.server.ts", 'import "$lib/server/s";\n');

    write("packages/game-engine/src/command-grammar.ts");
    write(
      "packages/game-engine/src/uses-grammar.ts",
      'import "./command-grammar.ts";\n',
    );
    write(
      "web/src/lib/domain/own-parser.ts",
      'import "../../../../packages/game-engine/src/command-grammar.ts";\n',
    );
    write(
      "evaluation/playtest/lib/own-parser.mjs",
      'import "../../../packages/game-engine/src/command-grammar.ts";\n',
    );
    write(
      "evaluation/playtest/lib/plays.mjs",
      'import "./other.mjs";\n',
    );
    write("evaluation/playtest/lib/other.mjs");
    write(
      "tests/api/unit/grammar.test.ts",
      'import "../../../packages/game-engine/src/command-grammar.ts";\n',
    );

    violations = await findViolations({ baseDir: dir });
  }, 60_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("flags shared code that imports the engine", () => {
    expect(
      rulesBrokenBy(violations, "packages/shared/src/reaches-engine.ts"),
    ).toEqual(["shared-imports-only-shared"]);
    expect(rulesBrokenBy(violations, "packages/shared/src/ok.ts")).toEqual([]);
  });

  it("flags the engine importing anything but itself and shared", () => {
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/reaches-web.ts"),
    ).toEqual(["engine-imports-engine-and-shared"]);
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/uses-shared.ts"),
    ).toEqual([]);
  });

  it("flags the SQLite driver imported outside db/client.ts", () => {
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/endpoints/e.ts"),
    ).toContain("sqlite-driver-only-in-db-client");
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/db/client.ts"),
    ).toEqual([]);
  });

  it("flags db/ imported from outside context-local.ts and db/", () => {
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/endpoints/e.ts"),
    ).toContain("db-only-from-context-local");
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/context-local.ts"),
    ).toEqual([]);
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/db/other.ts"),
    ).toEqual([]);
  });

  it("flags browser code that imports the engine or $lib/server, and allows the server side", () => {
    expect(rulesBrokenBy(violations, "web/src/lib/browser.ts")).toEqual([
      "browser-code-avoids-engine-and-server",
      "browser-code-avoids-engine-and-server",
    ]);
    expect(rulesBrokenBy(violations, "web/src/routes/api/+server.ts")).toEqual(
      [],
    );
    expect(rulesBrokenBy(violations, "web/src/hooks.server.ts")).toEqual([]);
  });

  it("flags the domain layer importing components", () => {
    expect(rulesBrokenBy(violations, "web/src/lib/domain/d.ts")).toEqual([
      "domain-avoids-components-and-routes",
    ]);
  });

  it("flags the command grammar imported from the browser or the evaluation harnesses", () => {
    expect(rulesBrokenBy(violations, "web/src/lib/domain/own-parser.ts")).toContain(
      "grammar-only-in-engine",
    );
    expect(
      rulesBrokenBy(violations, "evaluation/playtest/lib/own-parser.mjs"),
    ).toEqual(["grammar-only-in-engine"]);
    expect(rulesBrokenBy(violations, "evaluation/playtest/lib/plays.mjs")).toEqual([]);
  });

  it("lets the engine, and the tests of it, import the command grammar", () => {
    expect(
      rulesBrokenBy(violations, "packages/game-engine/src/uses-grammar.ts"),
    ).toEqual([]);
    expect(rulesBrokenBy(violations, "tests/api/unit/grammar.test.ts")).toEqual([]);
  });

  it("flags an import cycle", () => {
    const cycles = violations.filter((key) => key.startsWith("no-cycles: "));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatch(/ring-[ab]\.ts -> .*ring-[ab]\.ts/);
  });
});

describe("the baseline of known violations", () => {
  const known = [
    "no-cycles: a.ts -> b.ts",
    "shared-imports-only-shared: s.ts -> e.ts",
  ];

  it("passes when the violations are exactly the known ones", () => {
    const diff = compareToBaseline([...known], known);
    expect(describeDiff(diff)).toBeNull();
  });

  it("fails on a violation that is not in it", () => {
    const diff = compareToBaseline(
      [...known, "no-cycles: c.ts -> d.ts"],
      known,
    );
    expect(diff.added).toEqual(["no-cycles: c.ts -> d.ts"]);
    expect(describeDiff(diff)).toContain("not in the baseline");
  });

  it("fails on an entry whose violation no longer exists", () => {
    const diff = compareToBaseline([known[0]], known);
    expect(diff.stale).toEqual([known[1]]);
    expect(describeDiff(diff)).toContain("no longer occur");
  });
});
