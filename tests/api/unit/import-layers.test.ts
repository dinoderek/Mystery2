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
    write(
      "web/src/lib/server/reaches-db.ts",
      'import "../../../../packages/game-engine/src/db/other.ts";\n',
    );

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

    // What evaluation/ may and may not import.
    write("packages/blueprint-generator/src/index.ts");
    write("packages/game-engine/src/paths.ts");
    write("packages/game-engine/src/ai-provider-claude-cli.ts");
    write("web/src/lib/domain/notebook.ts");
    write("web/src/lib/domain/store.retry.ts");
    write("lib/database-target.mjs");
    write("scripts/lib/helper.mjs");
    write("tests/api/unit/helper.ts");
    write(
      "evaluation/tools/allowed.mjs",
      [
        'import "../../packages/game-engine/src/index.ts";',
        'import "../../packages/shared/src/ok.ts";',
        'import "../../packages/blueprint-generator/src/index.ts";',
        'import "../../web/src/lib/domain/notebook.ts";',
        'import "../../web/src/lib/domain/store.retry.ts";',
        'import "../../scripts/lib/helper.mjs";',
        "",
      ].join("\n"),
    );
    write(
      "evaluation/tools/reaches-web.mjs",
      'import "../../web/src/lib/domain/d.ts";\n',
    );
    write(
      "evaluation/tools/reaches-tests.mjs",
      'import "../../tests/api/unit/helper.ts";\n',
    );
    write(
      "web/src/routes/api/uses-evaluation.ts",
      'import "../../../../evaluation/tools/allowed.mjs";\n',
    );
    write(
      "web/src/lib/uses-evaluation.ts",
      'import "../../../evaluation/tools/allowed.mjs";\n',
    );

    // Starting a model subprocess, and resolving the play database path.
    write("evaluation/core/runner.mjs", 'import "node:child_process";\n');
    write("evaluation/pipeline/spawns.mjs", 'import "node:child_process";\n');
    write(
      "evaluation/playtest/lib/claude.mjs",
      'import "../../../packages/game-engine/src/ai-provider-claude-cli.ts";\n',
    );
    write("scripts/spawns.mjs", 'import "node:child_process";\n');
    write(
      "evaluation/trace/lib/datasource.ts",
      'import "../../../packages/game-engine/src/paths.ts";\nimport "../../../lib/database-target.mjs";\n',
    );
    write(
      "evaluation/runtime/lib/seeds.mjs",
      'import "../../../packages/game-engine/src/paths.ts";\n',
    );
    write(
      "evaluation/playtest/lib/target.mjs",
      'import "../../../lib/database-target.mjs";\n',
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
    expect(
      rulesBrokenBy(violations, "web/src/lib/server/reaches-db.ts"),
    ).toEqual(["db-only-from-context-local"]);
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

  it("lets evaluation import the engine, shared, the generator, the notebook, the retry rule, scripts and lib", () => {
    expect(rulesBrokenBy(violations, "evaluation/tools/allowed.mjs")).toEqual(
      [],
    );
  });

  it("flags evaluation importing other web code or the tests", () => {
    expect(rulesBrokenBy(violations, "evaluation/tools/reaches-web.mjs")).toEqual(
      ["evaluation-imports-only-what-it-may"],
    );
    expect(rulesBrokenBy(violations, "evaluation/tools/reaches-tests.mjs")).toEqual(
      ["evaluation-imports-only-what-it-may"],
    );
  });

  it("flags packages and web importing evaluation, and not evaluation importing itself", () => {
    expect(rulesBrokenBy(violations, "web/src/lib/uses-evaluation.ts")).toContain(
      "nothing-imports-evaluation",
    );
    expect(
      rulesBrokenBy(violations, "web/src/routes/api/uses-evaluation.ts"),
    ).toEqual(["nothing-imports-evaluation"]);
    expect(rulesBrokenBy(violations, "evaluation/playtest/lib/plays.mjs")).toEqual(
      [],
    );
  });

  it("flags a model subprocess started outside evaluation/core/", () => {
    expect(rulesBrokenBy(violations, "evaluation/pipeline/spawns.mjs")).toEqual([
      "model-subprocess-only-in-evaluation-core",
    ]);
    expect(rulesBrokenBy(violations, "evaluation/playtest/lib/claude.mjs")).toEqual(
      ["model-subprocess-only-in-evaluation-core"],
    );
    expect(rulesBrokenBy(violations, "evaluation/core/runner.mjs")).toEqual([]);
    // The rule is about evaluation; the scripts start processes of their own.
    expect(rulesBrokenBy(violations, "scripts/spawns.mjs")).toEqual([]);
  });

  it("flags the play database path resolved outside the trace extractor", () => {
    expect(rulesBrokenBy(violations, "evaluation/runtime/lib/seeds.mjs")).toEqual([
      "play-database-path-only-in-trace-extractor",
    ]);
    expect(rulesBrokenBy(violations, "evaluation/playtest/lib/target.mjs")).toEqual(
      ["play-database-path-only-in-trace-extractor"],
    );
    expect(rulesBrokenBy(violations, "evaluation/trace/lib/datasource.ts")).toEqual(
      [],
    );
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
