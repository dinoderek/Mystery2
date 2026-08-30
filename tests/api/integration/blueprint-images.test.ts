import fs from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  BASE_URL,
  MOCK_BLUEPRINT_ID,
  removeTestImage,
  seedTestImage,
  setupApiTestAuth,
  STUB_PNG,
  type ApiAuthContext,
} from "./helpers";
import { collectBlueprintImageReferences } from "../../../scripts/lib/blueprint-image-manifest.mjs";
import { buildImageStorageKey } from "../../../packages/game-engine/src/images.ts";

// The contract: the image ids a blueprint names are the files the server
// serves, at the path `blueprintImageUrl()` builds — and only those.

describe("blueprint images", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("blueprint-images");
  });

  async function mockBlueprint() {
    return JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), "blueprints/mock-blueprint.json"), "utf-8"),
    );
  }

  it("serves every image the blueprint references, at the path the link endpoint returns", async () => {
    const blueprint = await mockBlueprint();
    const references = collectBlueprintImageReferences(blueprint);
    expect(references.length).toBeGreaterThanOrEqual(3); // cover + location + portrait

    for (const reference of references) {
      seedTestImage(reference.imageFilename);
    }

    for (const reference of references) {
      const key = buildImageStorageKey(MOCK_BLUEPRINT_ID, reference.imageFilename);
      const bytesRes = await fetch(`${BASE_URL}/api/images/${key}`, {
        headers: { Cookie: auth.headers.Cookie },
      });

      expect(bytesRes.status, key).toBe(200);
      expect(bytesRes.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await bytesRes.arrayBuffer())).toEqual(STUB_PNG);
    }
  });

  it("404s an image the blueprint does not reference, even when the file exists", async () => {
    // The private bucket's read policy became this check: being signed in is
    // not enough, the blueprint has to name the image.
    seedTestImage("mock-blueprint.unreferenced.png");

    const bytesRes = await fetch(
      `${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/mock-blueprint.unreferenced.png`,
      { headers: { Cookie: auth.headers.Cookie } },
    );
    expect(bytesRes.status).toBe(404);
  });

  it("404s a referenced image whose file is missing", async () => {
    const blueprint = await mockBlueprint();
    const coverId: string = blueprint.metadata.image_id;

    // An earlier test in this file may have seeded it; the case under test is
    // a blueprint that names an image nobody has generated yet.
    removeTestImage(coverId);

    const bytesRes = await fetch(`${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/${coverId}`, {
      headers: { Cookie: auth.headers.Cookie },
    });
    expect(bytesRes.status).toBe(404);
  });

  it("rejects an image id that is not a canonical filename", async () => {
    const bytesRes = await fetch(
      `${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/${encodeURIComponent("../secrets.png")}`,
      { headers: { Cookie: auth.headers.Cookie } },
    );
    expect(bytesRes.status).toBe(400);
  });
});
