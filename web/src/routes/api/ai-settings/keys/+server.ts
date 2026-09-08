// Labelled OpenRouter keys: add, replace, remove.
//
// A key travels inward only. `POST` accepts one, nothing here ever returns one,
// and `readSettingsState` masks every key on the way out.

import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine';
import { readJsonBody, readSettingsState, settingsError } from '$lib/server/ai-settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJsonBody(request);
	const label = typeof body?.label === 'string' ? body.label : '';
	const apiKey = typeof body?.api_key === 'string' ? body.api_key : '';

	if (!label.trim()) return json({ error: 'Missing label' }, { status: 400 });
	if (!apiKey.trim()) return json({ error: 'Missing API key' }, { status: 400 });

	try {
		getEngine().aiSettings.putKey(label, apiKey);
	} catch (error) {
		return settingsError(error);
	}

	return json(readSettingsState());
};

export const DELETE: RequestHandler = ({ url }) => {
	const label = url.searchParams.get('label')?.trim() ?? '';
	if (!label) return json({ error: 'Missing label' }, { status: 400 });

	try {
		if (!getEngine().aiSettings.deleteKey(label)) {
			return json({ error: `No API key is stored under "${label}".` }, { status: 404 });
		}
	} catch (error) {
		return settingsError(error);
	}

	return json(readSettingsState());
};
