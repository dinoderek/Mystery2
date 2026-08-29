// The engine's `.env*.local` reader.
//
// It is a re-implementation of the parser in `scripts/supabase-utils.mjs`
// (which the engine must not depend on — that module boots Docker and is
// deleted in P5), so these cases pin the rules the two have to share.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseEnvFile,
  readEnvFile,
} from "../../../packages/game-engine/src/env-file.ts";
import { parseEnvLine } from "../../../scripts/supabase-utils.mjs";

describe("parseEnvFile", () => {
  it("reads key/value pairs, ignoring comments and blank lines", () => {
    expect(
      parseEnvFile(
        [
          "# a comment",
          "",
          "AI_PROVIDER=openrouter",
          "  AI_MODEL = some/model  ",
          "QUOTED=\"sk-with spaces\"",
          "SINGLE='sk-single'",
          "EMPTY=",
          "no-equals-sign",
          "=missing-key",
        ].join("\n"),
      ),
    ).toEqual({
      AI_PROVIDER: "openrouter",
      AI_MODEL: "some/model",
      QUOTED: "sk-with spaces",
      SINGLE: "sk-single",
      EMPTY: "",
    });
  });

  it("keeps `=` inside a value", () => {
    expect(parseEnvFile("OPENROUTER_API_KEY=sk-or-v1=abc")).toEqual({
      OPENROUTER_API_KEY: "sk-or-v1=abc",
    });
  });

  it("agrees line for line with the script parser it replaces", () => {
    const lines = [
      "# comment",
      "",
      "A=1",
      "  B = two  ",
      'C="quoted value"',
      "D=has=equals",
      "no-equals",
    ];

    const viaScript = Object.fromEntries(
      lines.map(parseEnvLine).filter((entry): entry is [string, string] => entry !== null),
    );

    expect(parseEnvFile(lines.join("\n"))).toEqual(viaScript);
  });
});

describe("readEnvFile", () => {
  it("returns an empty record when the file does not exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-engine-env-"));
    try {
      expect(readEnvFile(path.join(dir, ".env.local"))).toEqual({});

      fs.writeFileSync(path.join(dir, ".env.local"), "OPENROUTER_API_KEY=sk-test\n");
      expect(readEnvFile(path.join(dir, ".env.local"))).toEqual({
        OPENROUTER_API_KEY: "sk-test",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
