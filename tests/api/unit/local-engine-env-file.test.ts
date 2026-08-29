// The engine's `.env*.local` reader.
//
// The scripts read the same files through `scripts/lib/env-file.mjs`, which
// wraps this parser, so these cases pin the rules for both.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseEnvFile,
  readEnvFile,
} from "../../../packages/game-engine/src/env-file.ts";

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
