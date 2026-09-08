// Reading the AI settings, and choosing among them.
//
// Unauthenticated on purpose: the page that uses this sits in front of the
// profile picker, so there is no player yet. That is the same access model the
// rest of the game has — the database is a file on this machine, and profiles
// separate one person's cases from another's rather than keeping anyone out.
// It does mean this route must never hand back a stored key; `readSettingsState`
// is the one place that decides what leaves.

import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine';
import { readJsonBody, readSettingsState, settingsError } from '$lib/server/ai-settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(readSettingsState());

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJsonBody(request);
	if (!body) return json({ error: 'Expected a JSON body' }, { status: 400 });

	const update: Parameters<ReturnType<typeof getEngine>['aiSettings']['updateSettings']>[0] = {};

	if (body.mode !== undefined) {
		if (body.mode !== 'mock' && body.mode !== 'openrouter') {
			return json({ error: 'mode must be "mock" or "openrouter"' }, { status: 400 });
		}
		update.ai_mode = body.mode;
	}

	// `null` is a meaningful value here — it clears the selection — so the three
	// states (absent, null, string) are kept distinct rather than collapsed.
	if (body.key_label !== undefined) {
		if (body.key_label !== null && typeof body.key_label !== 'string') {
			return json({ error: 'key_label must be a string or null' }, { status: 400 });
		}
		update.ai_key_label = body.key_label;
	}

	if (body.model_label !== undefined) {
		if (body.model_label !== null && typeof body.model_label !== 'string') {
			return json({ error: 'model_label must be a string or null' }, { status: 400 });
		}
		update.ai_model_label = body.model_label;
	}

	if (Object.keys(update).length === 0) {
		return json({ error: 'Nothing to update' }, { status: 400 });
	}

	try {
		getEngine().aiSettings.updateSettings(update);
	} catch (error) {
		return settingsError(error);
	}

	return json(readSettingsState());
};
