// The current local profile: who you are, signing in, signing out.
//
// Signing in is naming a profile — it is created if it does not exist — and
// the answer is a cookie holding its id. There is no password because there is
// nothing to protect against: the database is a file on the player's own
// machine, and profiles exist to keep one person's cases separate from
// another's, not to keep anyone out.

import { json } from '@sveltejs/kit';
import { getEngine, playerCookie } from '$lib/server/engine';
import type { RequestHandler } from './$types';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const GET: RequestHandler = ({ locals }) => json({ player: locals.player });

/**
 * The cookie is never `Secure`, because the game is never served over https.
 *
 * It is one Node process on the player's own machine, reached over plain http:
 * `npm run dev` prints a `127.0.0.1` URL, and a LAN address or a `.local` name
 * reaches the same server. A `Secure` cookie is discarded over http, so marking
 * it made signing in *appear* to work — the response carries the profile, so
 * the menu renders — while the browser threw the cookie away and every request
 * afterwards answered 401.
 *
 * SvelteKit's default is the trap: it marks the cookie `Secure` for every
 * hostname except the literal string `localhost`, so exactly one of the several
 * origins this server answers on worked. Nor can the request be asked instead —
 * `adapter-node` reports `url.protocol` as `https:` when no `ORIGIN` is set,
 * which is how it runs here.
 *
 * Revisit this the day the game is served over TLS. Until then the flag can
 * only be wrong.
 */
const SECURE_COOKIE = false;

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';

	if (!name) return json({ error: 'Missing profile name' }, { status: 400 });
	if (name.length > 60) {
		return json({ error: 'Profile name is too long' }, { status: 400 });
	}

	const player = getEngine().players.ensure(name);

	cookies.set(playerCookie(), player.id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: SECURE_COOKIE,
		maxAge: ONE_YEAR_SECONDS,
	});

	return json({ player });
};

export const DELETE: RequestHandler = ({ cookies }) => {
	// The attributes have to match the ones it was set with, or the expiry
	// lands on a different cookie than the one signing in created.
	cookies.delete(playerCookie(), { path: '/', secure: SECURE_COOKIE });
	return json({ player: null });
};
