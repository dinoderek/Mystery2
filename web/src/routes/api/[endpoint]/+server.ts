// The one route that serves every game endpoint.
//
// The preamble every endpoint needs — check the method, build a context,
// delegate — lives here once. The endpoints themselves are plain
// `handle(req, ctx)` functions in the engine's registry, and that registry is
// also where each one declares whether it runs as a profile.

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

	const engine = getEngine();

	// A catalog endpoint reads content every profile shares, so there is nobody
	// to be: it gets a context with no owned state on it at all.
	if (endpoint.access === 'catalog') {
		return endpoint.handle(event.request, engine.catalogContext());
	}

	// Everything else manages or plays a session, so it has to run as someone.
	if (!event.locals.player) {
		return json({ error: 'Not signed in' }, { status: 401 });
	}

	return endpoint.handle(
		event.request,
		engine.contextFor({ id: event.locals.player.id, name: event.locals.player.name }),
	);
}

export const GET: RequestHandler = (event) => dispatch(event, 'GET');
export const POST: RequestHandler = (event) => dispatch(event, 'POST');
