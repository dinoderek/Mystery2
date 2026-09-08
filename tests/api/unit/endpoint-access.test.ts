import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "../../../packages/game-engine/src/endpoints/index.ts";

// Which endpoints run as a profile, held to the rule rather than to habit.
//
// The criterion is ownership: an endpoint that manages or plays a game session
// runs as somebody, and everything else does not. Nothing can check that
// statically — a handler's access is a claim about what it touches — so the
// claim is written down here, and a new endpoint has to come past it.

const CATALOG_ENDPOINTS = ["blueprints-list"];

describe("endpoint access", () => {
  it("runs as a profile for everything that manages or plays a session", () => {
    const profileScoped = ENDPOINTS.filter((endpoint) => endpoint.access === "profile")
      .map((endpoint) => endpoint.name)
      .sort();

    // Every session endpoint is a `game-*`, and every `game-*` is one.
    expect(profileScoped).toEqual(
      ENDPOINTS.map((endpoint) => endpoint.name)
        .filter((name) => name.startsWith("game-"))
        .sort(),
    );
  });

  it("runs without one only for endpoints over shared content", () => {
    const catalog = ENDPOINTS.filter((endpoint) => endpoint.access === "catalog")
      .map((endpoint) => endpoint.name)
      .sort();

    expect(catalog).toEqual([...CATALOG_ENDPOINTS].sort());
  });

  it("makes every endpoint declare which it is", () => {
    for (const endpoint of ENDPOINTS) {
      expect([endpoint.name, endpoint.access]).toEqual([
        endpoint.name,
        expect.stringMatching(/^(profile|catalog)$/),
      ]);
    }
  });
});
