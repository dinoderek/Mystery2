// Every local profile on this machine — the list the profile picker offers.

import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const players = getEngine()
		.players.list()
		.map(({ id, name }) => ({ id, name }));

	return json({ players });
};
