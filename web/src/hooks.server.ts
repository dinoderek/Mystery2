// Resolves the player cookie into `locals.player`.
//
// This is the whole of authentication now. There is no password, no token and
// no expiry: a local profile is a name and an id, the browser carries the id,
// and the engine's repositories scope every query to it. `/api/player` is what
// sets and clears the cookie.

import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { ALLOWED_HOSTS_ENV, isHostAllowed, parseAllowedHosts } from '@my2/game-engine';
import { getEngine, playerCookie } from '$lib/server/engine';

// Set by `./dev run --lan`, which serves every interface; unset, every host is
// answered (`packages/game-engine/src/allowed-hosts.ts`).
const allowedHosts = parseAllowedHosts(process.env[ALLOWED_HOSTS_ENV]);

// Opening the engine at start reads `ai.json` and the run override, so a
// malformed file, or `--ai` naming an AI that cannot narrate, stops the server
// with the AI and field named instead of failing the first request. Not while
// building, for the reason below.
export const init: ServerInit = () => {
	if (building) return;
	try {
		getEngine();
	} catch (error) {
		console.error(`The game server cannot start: ${(error as Error).message}`);
		throw error;
	}
};

export const handle: Handle = async ({ event, resolve }) => {
	// `npm -w web run build` prerenders the SPA shell through this hook. Opening
	// the engine there would create or migrate the database of whoever runs the
	// build (`database/main` in the main checkout), and the shell needs no player.
	if (building) {
		event.locals.player = null;
		return resolve(event);
	}

	const host = event.request.headers.get('host');
	if (allowedHosts && !isHostAllowed(host, allowedHosts)) {
		console.warn(
			`Refused a request for host "${host ?? ''}": add it to ${ALLOWED_HOSTS_ENV} to play from that address.`
		);
		return new Response(`This game does not answer the host "${host ?? ''}".`, { status: 403 });
	}

	const playerId = event.cookies.get(playerCookie());

	// An id that no longer resolves — a profile deleted, or a database started
	// from scratch — is treated as signed out rather than as an error.
	event.locals.player = playerId ? getEngine().players.getById(playerId) : null;

	return resolve(event);
};
