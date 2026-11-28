#!/usr/bin/env node
// `npm run images:compress [-- <dir>]`: gives every PNG in the images directory
// (default `<config root>/blueprint-images/`) a current WebP. `./dev gen-images`
// does this for the images it writes; this catches images made any other way.

import { pathToFileURL } from "node:url";
import { compressImagesInDir } from "./lib/compress-image.mjs";
import { getBlueprintImagesDir } from "./local-config.mjs";

function megabytes(bytes) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export async function runCompressImages(argv, { out = console.log, err = console.error, env = process.env } = {}) {
  const dir = argv[0] ?? getBlueprintImagesDir(process.cwd(), env);
  const { compressed, failed } = await compressImagesInDir(dir);
  for (const item of compressed) {
    out(`[compressed] ${item.output} (${megabytes(item.before)} -> ${megabytes(item.after)})`);
  }
  for (const item of failed) {
    err(`[error] ${item.source}: ${item.error}`);
  }
  out(`[summary] ${dir}: ${compressed.length} compressed, ${failed.length} failed, the rest already current`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCompressImages(process.argv.slice(2));
}
