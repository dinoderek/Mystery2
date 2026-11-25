// The player's catalog leaves out what the content store marks unlisted: the
// test fixture, which still loads by id for the suites and the playtest.

import { describe, expect, it } from "vitest";

import { handle } from "../../../packages/game-engine/src/endpoints/blueprints-list.ts";
import type { CatalogContext } from "../../../packages/game-engine/src/context.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

describe("blueprints-list", () => {
  it("lists every case but the unlisted ones", async () => {
    const listed = readMockCase();
    const fixture = { ...readMockCase(), id: "fixture-id" };
    const ctx = {
      content: {
        listBlueprints: async () => [
          { blueprint: listed, source: "listed.json" },
          { blueprint: fixture, source: "fixture.json", unlisted: true as const },
        ],
      },
    } as unknown as CatalogContext;

    const response = await handle(new Request("http://localhost/api/blueprints-list"), ctx);

    expect((await response.json()).blueprints.map((entry: { id: string }) => entry.id)).toEqual([listed.id]);
  });
});
