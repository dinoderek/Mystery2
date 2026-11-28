import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { runCompressImages } from "../../../scripts/compress-blueprint-images.mjs";
import { compressImagesInDir } from "../../../scripts/lib/compress-image.mjs";

type Item = { source: string; output: string };

const PNG_BYTES = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#36c" } }).png().toBuffer();

async function imagesDir() {
  return mkdtemp(path.join(os.tmpdir(), "mystery-compress-"));
}

describe("compressImagesInDir", () => {
  it("writes a full-size WebP beside every PNG", async () => {
    const dir = await imagesDir();
    await writeFile(path.join(dir, "case.blueprint.png"), PNG_BYTES);

    const { compressed, failed } = await compressImagesInDir(dir);

    expect(failed).toEqual([]);
    expect(compressed.map((item: Item) => path.basename(item.output))).toEqual(["case.blueprint.webp"]);
    expect(await sharp(path.join(dir, "case.blueprint.webp")).metadata()).toMatchObject({ format: "webp", width: 3, height: 2 });
  });

  it("leaves a current WebP alone and redoes one older than its PNG", async () => {
    const dir = await imagesDir();
    await writeFile(path.join(dir, "a.cover.png"), PNG_BYTES);
    await writeFile(path.join(dir, "b.cover.png"), PNG_BYTES);
    await compressImagesInDir(dir);
    await utimes(path.join(dir, "b.cover.webp"), 1_000, 1_000);

    const { compressed } = await compressImagesInDir(dir);

    expect(compressed.map((item: Item) => path.basename(item.source))).toEqual(["b.cover.png"]);
  });

  it("reports a PNG it cannot decode and still compresses the rest", async () => {
    const dir = await imagesDir();
    await writeFile(path.join(dir, "a.broken.png"), "not an image");
    await writeFile(path.join(dir, "b.cover.png"), PNG_BYTES);

    const { compressed, failed } = await compressImagesInDir(dir);

    expect(failed.map((item: Item) => path.basename(item.source))).toEqual(["a.broken.png"]);
    expect(compressed.map((item: Item) => path.basename(item.source))).toEqual(["b.cover.png"]);
  });
});

describe("runCompressImages", () => {
  it("exits non-zero when any image failed, naming it", async () => {
    const dir = await imagesDir();
    await writeFile(path.join(dir, "a.broken.png"), "not an image");
    const errors: string[] = [];

    const code = await runCompressImages([dir], { out: () => {}, err: (line: string) => errors.push(line) });

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("a.broken.png");
  });

  it("compresses the config root's images directory by default", async () => {
    const root = await imagesDir();
    const dir = path.join(root, "blueprint-images");
    await mkdir(dir);
    await writeFile(path.join(dir, "case.blueprint.png"), PNG_BYTES);
    const lines: string[] = [];

    const code = await runCompressImages([], { out: (line: string) => lines.push(line), err: () => {}, env: { MYSTERY_CONFIG_ROOT: root } });

    expect(code).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(["case.blueprint.png", "case.blueprint.webp"]);
    expect(lines.at(-1)).toContain("1 compressed, 0 failed");
  });
});
