import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  ImageGenerationError,
  OPENROUTER_IMAGES_URL,
  buildImageGenerationRequest,
  generateImageAsset,
  isCommittedCase,
  parseGenerateImageArgs,
  parseImagePayload,
  runImageGeneration,
} from "../../../scripts/generate-blueprint-images.mjs";
import { createImageId } from "../../../scripts/lib/image-prompt-builder.mjs";

const MOCK_CASE = path.resolve("blueprints/clue-graph/mock-case.json");

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imagesApiResponse(
  bytes: Buffer = PNG_BYTES,
  mediaType: string | null = "image/png",
) {
  const entry: Record<string, unknown> = { b64_json: bytes.toString("base64") };
  if (mediaType) entry.media_type = mediaType;
  return new Response(
    JSON.stringify({ created: 1748372400, data: [entry], usage: { cost: 0.04 } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: { message, code: status, metadata: { provider_name: null } } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("image generation request", () => {
  it("builds an Images API body, not a chat-completions body", () => {
    const body = buildImageGenerationRequest({
      model: "openai/gpt-image-2",
      prompt: "a cozy kitchen",
      aspectRatio: "4:3",
    });

    expect(body).toEqual({
      model: "openai/gpt-image-2",
      prompt: "a cozy kitchen",
      aspect_ratio: "4:3",
      output_format: "png",
    });
    // Regression guard: the chat-completions shape 404s for image models.
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("modalities");
    expect(body).not.toHaveProperty("image_config");
  });

  it("maps reference buffers to input_references in order", () => {
    const first = Buffer.from("first-reference");
    const second = Buffer.from("second-reference");

    const body = buildImageGenerationRequest({
      model: "openai/gpt-image-2",
      prompt: "a location scene",
      aspectRatio: "4:3",
      referenceImages: [
        { label: "Portrait of Alice", buffer: first },
        { label: "Portrait of Bob", buffer: second },
      ],
    });

    // Ordinal position is how the model matches these to the prompt legend.
    expect(body.input_references).toHaveLength(2);
    expect(body.input_references[0]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${first.toString("base64")}` },
    });
    expect(body.input_references[1].image_url.url).toContain(
      second.toString("base64"),
    );
  });

  it("omits input_references when there are no references", () => {
    const body = buildImageGenerationRequest({
      model: "openai/gpt-image-2",
      prompt: "a portrait",
      aspectRatio: "1:1",
      referenceImages: [],
    });

    expect(body).not.toHaveProperty("input_references");
  });
});

describe("image payload parsing", () => {
  it("decodes data[0].b64_json into a buffer", () => {
    const decoded = parseImagePayload({
      data: [{ b64_json: PNG_BYTES.toString("base64"), media_type: "image/png" }],
    });

    expect(Buffer.isBuffer(decoded)).toBe(true);
    expect(decoded.equals(PNG_BYTES)).toBe(true);
  });

  it("accepts a payload with no media_type", () => {
    const decoded = parseImagePayload({
      data: [{ b64_json: PNG_BYTES.toString("base64") }],
    });

    expect(decoded.equals(PNG_BYTES)).toBe(true);
  });

  it("throws when data is empty", () => {
    expect(() => parseImagePayload({ created: 1, data: [] })).toThrow(
      ImageGenerationError,
    );
    try {
      parseImagePayload({ created: 1, data: [] });
    } catch (error) {
      expect(error).toMatchObject({ name: "ImageGenerationError", phase: "parse" });
    }
  });

  it("rejects a non-png media_type", () => {
    try {
      parseImagePayload({
        data: [{ b64_json: PNG_BYTES.toString("base64"), media_type: "image/jpeg" }],
      });
      expect.unreachable("expected a parse error");
    } catch (error) {
      expect(error).toMatchObject({ name: "ImageGenerationError", phase: "parse" });
      expect((error as Error).message).toContain("image/jpeg");
      expect((error as Error).message).toContain(".png");
    }
  });

  it("names data[0].url when the entry has a url but no b64_json", () => {
    try {
      parseImagePayload({ data: [{ url: "https://example.com/generated.png" }] });
      expect.unreachable("expected a parse error");
    } catch (error) {
      expect((error as Error).message).toContain("data[0].url");
    }
  });

  it("keeps the base64 blob out of error output", () => {
    const blob = "A".repeat(50_000);

    try {
      parseImagePayload({ data: [{ b64_json: blob, media_type: "image/webp" }] });
      expect.unreachable("expected a parse error");
    } catch (error) {
      const body = (error as { responseBody?: string }).responseBody ?? "";
      expect(body).not.toContain(blob);
      expect(body).toContain("50000 base64 chars omitted");
    }
  });
});

describe("generateImageAsset", () => {
  const baseArgs = {
    prompt: "a cozy kitchen",
    model: "openai/gpt-image-2",
    aspectRatio: "4:3",
    apiKey: "test-key",
    timeoutMs: 1000,
  };

  it("posts to the Images API and returns decoded bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imagesApiResponse());

    const bytes = await generateImageAsset({ ...baseArgs, fetchImpl: fetchMock });

    expect(bytes.equals(PNG_BYTES)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    expect(url).toBe(OPENROUTER_IMAGES_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "openai/gpt-image-2",
      aspect_ratio: "4:3",
      output_format: "png",
    });
  });

  it("surfaces the provider message on a chat-endpoint 404", async () => {
    const providerMessage =
      "openai/gpt-image-2 is an image generation model and cannot be used with the chat/completions endpoint. Use the /api/v1/images endpoint instead.";
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, providerMessage));

    await expect(
      generateImageAsset({ ...baseArgs, fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      name: "ImageGenerationError",
      phase: "generation",
      status: 404,
      url: OPENROUTER_IMAGES_URL,
      message: expect.stringContaining("cannot be used with the chat/completions endpoint"),
    });
  });

  it("explains that a 502 is unbilled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorResponse(502, "Provider returned no image"));

    await expect(
      generateImageAsset({ ...baseArgs, fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      name: "ImageGenerationError",
      phase: "generation",
      status: 502,
      message: expect.stringContaining("not billed"),
    });
  });

  it("maps abort failures to a timeout error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(
      generateImageAsset({ ...baseArgs, fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      name: "ImageGenerationError",
      phase: "generation",
      message: "OpenRouter image generation timed out after 1000ms",
    });
  });
});

describe("generate-blueprint-images CLI args", () => {
  it("defaults to Seedream 5.5 at 4:3 and honours the override chain", () => {
    expect(
      parseGenerateImageArgs(["--blueprint-path", "bp.json"], {
        MYSTERY_CONFIG_ROOT: "/tmp/shared-config",
      }),
    ).toMatchObject({ model: "bytedance-seed/seedream-5-5", aspectRatio: "4:3" });

    expect(
      parseGenerateImageArgs(["--blueprint-path", "bp.json"], {
        MYSTERY_CONFIG_ROOT: "/tmp/shared-config",
        OPENROUTER_IMAGE_MODEL: "openai/gpt-image-1",
        OPENROUTER_IMAGE_ASPECT_RATIO: "3:2",
      }),
    ).toMatchObject({ model: "openai/gpt-image-1", aspectRatio: "3:2" });

    expect(
      parseGenerateImageArgs(
        [
          "--blueprint-path", "bp.json",
          "--model", "google/gemini-3-pro-image",
          "--aspect-ratio", "16:9",
        ],
        {
          MYSTERY_CONFIG_ROOT: "/tmp/shared-config",
          OPENROUTER_IMAGE_MODEL: "openai/gpt-image-1",
          OPENROUTER_IMAGE_ASPECT_RATIO: "3:2",
        },
      ),
    ).toMatchObject({ model: "google/gemini-3-pro-image", aspectRatio: "16:9" });
  });

  it("rejects an unsupported aspect ratio", () => {
    expect(() =>
      parseGenerateImageArgs(
        ["--blueprint-path", "bp.json", "--aspect-ratio", "5:4"],
        { MYSTERY_CONFIG_ROOT: "/tmp/shared-config" },
      ),
    ).toThrow(/Invalid --aspect-ratio "5:4".*1:1, 3:2/s);
  });
});

describe("runImageGeneration", () => {
  async function withBlueprint() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mystery-images-"));
    const blueprintPath = path.join(dir, "blueprint.json");
    await copyFile(MOCK_CASE, blueprintPath);
    return { dir, blueprintPath, outputDir: path.join(dir, "images") };
  }

  const characterKey = "char-alice";
  const blueprintName = "Mock Case";

  it("writes the decoded png and patches the blueprint", async () => {
    const { blueprintPath, outputDir } = await withBlueprint();
    const fetchMock = vi.fn().mockResolvedValue(imagesApiResponse());

    const options = parseGenerateImageArgs(
      [
        "--blueprint-path", blueprintPath,
        "--output-dir", outputDir,
        "--characters", characterKey,
      ],
      { MYSTERY_CONFIG_ROOT: "/tmp/shared-config" },
    );

    const output = await runImageGeneration(options, {
      fetchImpl: fetchMock,
      apiKey: "test-key",
      env: { MYSTERY_CONFIG_ROOT: "/tmp/shared-config" },
    });

    const expectedId = `${createImageId(blueprintName, "character", characterKey)}.png`;
    expect(output.results).toEqual([
      expect.objectContaining({
        target_type: "character",
        target_key: characterKey,
        status: "generated",
        image_id: expectedId,
      }),
    ]);

    const written = await readFile(path.join(outputDir, expectedId));
    expect(written.equals(PNG_BYTES)).toBe(true);

    expect(fetchMock.mock.calls[0][0]).toBe(OPENROUTER_IMAGES_URL);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.aspect_ratio).toBe("4:3");
    expect(sent).not.toHaveProperty("messages");

    const patched = JSON.parse(await readFile(blueprintPath, "utf-8"));
    expect(patched.characters[characterKey].portrait_image_id).toBe(expectedId);
  });

  it("files a committed case's images under their conventional names and leaves the case unpatched", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "mystery-images-"));
    const before = await readFile(MOCK_CASE, "utf-8");
    const fetchMock = vi.fn().mockImplementation(async () => imagesApiResponse());
    const options = parseGenerateImageArgs(["--blueprint-path", MOCK_CASE, "--output-dir", outputDir, "--characters", characterKey]);

    for (let run = 0; run < 2; run += 1) {
      const output = await runImageGeneration(options, { fetchImpl: fetchMock, apiKey: "test-key", env: {} });
      expect(output.results).toEqual([
        expect.objectContaining({ status: "generated", image_id: `mock-case.character-${characterKey}.png` }),
      ]);
    }

    // The second run replaced the first image rather than writing a `-1` beside it.
    expect(await readdir(outputDir)).toEqual([`mock-case.character-${characterKey}.png`]);
    expect(await readFile(MOCK_CASE, "utf-8")).toBe(before);
  });

  it("references the portraits and locations already on disk when it makes only the cover", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "mystery-images-"));
    const cover = JSON.parse(await readFile(MOCK_CASE, "utf-8")).cover;
    for (const id of [...cover.characters.map((c: string) => `character-${c}`), ...cover.locations.map((l: string) => `location-${l}`)]) {
      await writeFile(path.join(outputDir, `mock-case.${id}.png`), PNG_BYTES);
    }
    const fetchMock = vi.fn().mockImplementation(async () => imagesApiResponse());
    const options = parseGenerateImageArgs(["--blueprint-path", MOCK_CASE, "--output-dir", outputDir, "--blueprint"]);

    await runImageGeneration(options, { fetchImpl: fetchMock, apiKey: "test-key", env: {} });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.input_references).toHaveLength(cover.characters.length + cover.locations.length);
  });

  it("references a portrait by the id a patched case names", async () => {
    const { blueprintPath, outputDir } = await withBlueprint();
    const graph = JSON.parse(await readFile(blueprintPath, "utf-8"));
    for (const person of Object.values(graph.characters) as Array<Record<string, unknown>>) delete person.portrait_image_id;
    for (const place of Object.values(graph.locations) as Array<Record<string, unknown>>) delete place.location_image_id;
    graph.characters["char-alice"].portrait_image_id = "alice-from-an-earlier-run.png";
    await writeFile(blueprintPath, JSON.stringify(graph));
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "alice-from-an-earlier-run.png"), PNG_BYTES);
    const fetchMock = vi.fn().mockImplementation(async () => imagesApiResponse());

    await runImageGeneration(parseGenerateImageArgs(["--blueprint-path", blueprintPath, "--output-dir", outputDir, "--blueprint"]), {
      fetchImpl: fetchMock, apiKey: "test-key", env: {},
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input_references).toHaveLength(1);
  });

  it("allows five minutes per image by default, for a cover with many references", () => {
    expect(DEFAULT_OPENROUTER_TIMEOUT_MS).toBe(300_000);
  });

  it("tells a committed case from one outside the repo's blueprints", () => {
    expect(isCommittedCase(MOCK_CASE)).toBe(true);
    expect(isCommittedCase(path.resolve("blueprints"))).toBe(false);
    expect(isCommittedCase(path.join(os.tmpdir(), "blueprints", "case.json"))).toBe(false);
  });

  it("reports a failed target without aborting the run", async () => {
    const { blueprintPath, outputDir } = await withBlueprint();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorResponse(502, "Provider returned no image"));

    const options = parseGenerateImageArgs(
      [
        "--blueprint-path", blueprintPath,
        "--output-dir", outputDir,
        "--characters", characterKey,
      ],
      { MYSTERY_CONFIG_ROOT: "/tmp/shared-config" },
    );

    const output = await runImageGeneration(options, {
      fetchImpl: fetchMock,
      apiKey: "test-key",
      env: { MYSTERY_CONFIG_ROOT: "/tmp/shared-config" },
    });

    expect(output.results[0]).toMatchObject({ status: "failed", image_id: null });
    expect(output.results[0].error_message).toContain("502");
    expect(output.results[0].error_message).toContain("Phase: generation");
  });
});
