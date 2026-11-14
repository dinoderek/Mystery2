// The AIs this server can narrate with, and the one chosen among them.
//
// Unauthenticated on purpose: the page that uses this sits in front of the
// profile picker, so there is no player yet. That is the same access model the
// rest of the game has — the database is a file on this machine, and profiles
// separate one person's cases from another's rather than keeping anyone out.
// No key leaves here: `describeAISettings` builds every answer, and it copies
// none into it.

import { json } from '@sveltejs/kit';
import { describeAISettings, handleAIChoice } from '@my2/game-engine';
import { getEngine } from '$lib/server/engine';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const engine = getEngine();
	return json(describeAISettings(engine.aiConfig, engine.aiSettings));
};

export const POST: RequestHandler = ({ request }) => {
	const engine = getEngine();
	return handleAIChoice(request, engine.aiConfig, engine.aiSettings);
};
