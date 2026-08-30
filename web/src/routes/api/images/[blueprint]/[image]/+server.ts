// Blueprint artwork, served straight off disk.
//
// The path is stable and derivable from a blueprint id and an image id, so
// there is nothing for the client to fetch first and nothing to expire. Two
// access rules apply: you have to be signed in, and the image has to be one
// the blueprint actually references.

import { error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureCanonicalImageId, resolveImageFile } from '@my2/game-engine';
import { getEngine } from '$lib/server/engine';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
};

const SILENT_LOGGER = { log: () => {}, logError: () => {} };

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.player) error(401, 'Not signed in');

	const imageId = ensureCanonicalImageId(params.image);
	if (!imageId) error(400, 'Invalid image id');

	const engine = getEngine();
	const blueprint = await engine.content.loadBlueprint(params.blueprint, SILENT_LOGGER);
	if (!blueprint) error(404, 'Blueprint not found');

	if (!isImageReferenced(blueprint, imageId)) {
		error(404, 'Image not referenced by blueprint');
	}

	const filePath = resolveImageFile(engine.imagesDir, imageId);
	if (!filePath) error(404, 'Image asset not found');

	return new Response(new Uint8Array(await fs.readFile(filePath)), {
		headers: {
			'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
			// Image ids carry a uuid, so a given filename never changes content.
			'Cache-Control': 'public, max-age=3600',
		},
	});
};

type Blueprint = NonNullable<Awaited<ReturnType<ReturnType<typeof getEngine>['content']['loadBlueprint']>>>;

function isImageReferenced(blueprint: Blueprint, imageId: string): boolean {
	if (blueprint.metadata.image_id === imageId) return true;
	if (blueprint.world.locations.some((location) => location.location_image_id === imageId)) {
		return true;
	}
	return blueprint.world.characters.some(
		(character) => character.portrait_image_id === imageId,
	);
}
