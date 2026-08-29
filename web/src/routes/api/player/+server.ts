// The current local profile: who you are, signing in, signing out.
//
// Replaces Supabase Auth. Signing in is naming a profile — it is created if it
// does not exist — and the answer is a cookie holding its id. There is no
// password because there is nothing to protect against: the database is a file
// on the player's own machine, and profiles exist to keep one person's cases
// separate from another's, not to keep anyone out.

import { json } from '@sveltejs/kit';
import { PLAYER_COOKIE } from '../../../hooks.server';
import { getEngine } from '$lib/server/engine';
import type { RequestHandler } from './$types';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const GET: RequestHandler = ({ locals }) => json({ player: locals.player });

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';

	if (!name) return json({ error: 'Missing profile name' }, { status: 400 });
	if (name.length > 60) {
		return json({ error: 'Profile name is too long' }, { status: 400 });
	}

	const player = getEngine().players.ensure(name);

	cookies.set(PLAYER_COOKIE, player.id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: ONE_YEAR_SECONDS,
	});

	return json({ player });
};

export const DELETE: RequestHandler = ({ cookies }) => {
	cookies.delete(PLAYER_COOKIE, { path: '/' });
	return json({ player: null });
};
