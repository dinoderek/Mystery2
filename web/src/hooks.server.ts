// Resolves the player cookie into `locals.player`.
//
// This is the whole of authentication now. There is no password, no token and
// no expiry: a local profile is a name and an id, the browser carries the id,
// and the engine's repositories scope every query to it. `/api/player` is what
// sets and clears the cookie.

import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getEngine, playerCookie } from '$lib/server/engine';

export const handle: Handle = async ({ event, resolve }) => {
	// `npm -w web run build` prerenders the SPA shell through this hook. Opening
	// the engine there would create or migrate the database of whoever runs the
	// build (`database/main` in the main checkout), and the shell needs no player.
	if (building) {
		event.locals.player = null;
		return resolve(event);
	}

	const playerId = event.cookies.get(playerCookie());

	// An id that no longer resolves — a profile deleted, or a database started
	// from scratch — is treated as signed out rather than as an error.
	event.locals.player = playerId ? getEngine().players.getById(playerId) : null;

	return resolve(event);
};
