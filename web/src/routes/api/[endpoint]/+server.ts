// The one route that serves every game endpoint.
//
// The preamble every endpoint needs — check the method, resolve the profile,
// build a context, delegate — lives here once. The endpoints themselves are
// plain `handle(req, ctx)` functions in the engine's registry.

import { error, json } from '@sveltejs/kit';
import { findEndpoint, type EndpointMethod } from '@my2/game-engine';
import { getEngine } from '$lib/server/engine';
import type { RequestEvent, RequestHandler } from './$types';

async function dispatch(
	event: RequestEvent,
	method: EndpointMethod,
): Promise<Response> {
	const endpoint = findEndpoint(event.params.endpoint);
	if (!endpoint) error(404, `Unknown endpoint "${event.params.endpoint}"`);

	if (!endpoint.methods.includes(method)) {
		return new Response('Method not allowed', { status: 405 });
	}

	if (!event.locals.player) {
		return json({ error: 'Not signed in' }, { status: 401 });
	}

	const ctx = getEngine().contextFor({
		id: event.locals.player.id,
		name: event.locals.player.name,
	});

	return endpoint.handle(event.request, ctx);
}

export const GET: RequestHandler = (event) => dispatch(event, 'GET');
export const POST: RequestHandler = (event) => dispatch(event, 'POST');
