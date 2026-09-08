// Labelled models: add, replace, remove.
//
// Same shape as the keys route next door, minus the secrecy — a model id is
// public, so it is returned as it was stored.

import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine';
import { readJsonBody, readSettingsState, settingsError } from '$lib/server/ai-settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJsonBody(request);
	const label = typeof body?.label === 'string' ? body.label : '';
	const modelId = typeof body?.model_id === 'string' ? body.model_id : '';

	if (!label.trim()) return json({ error: 'Missing label' }, { status: 400 });
	if (!modelId.trim()) return json({ error: 'Missing model ID' }, { status: 400 });

	try {
		getEngine().aiSettings.putModel(label, modelId);
	} catch (error) {
		return settingsError(error);
	}

	return json(readSettingsState());
};

export const DELETE: RequestHandler = ({ url }) => {
	const label = url.searchParams.get('label')?.trim() ?? '';
	if (!label) return json({ error: 'Missing label' }, { status: 400 });

	try {
		if (!getEngine().aiSettings.deleteModel(label)) {
			return json({ error: `No model is stored under "${label}".` }, { status: 404 });
		}
	} catch (error) {
		return settingsError(error);
	}

	return json(readSettingsState());
};
