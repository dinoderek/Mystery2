// Shared shaping and error mapping for the three `/api/ai-settings` routes.
//
// One place decides what a settings response looks like, because the single
// rule that matters here — a stored API key never leaves the server — has to
// hold on every one of them, and a rule re-implemented per route is a rule that
// eventually is not.

import { json } from '@sveltejs/kit';
import {
	EnvRowLockedError,
	InvalidLabelError,
	readDefaultAIOverride,
	type AIKeyRecord
} from '@my2/game-engine';
import type { AISettingsState } from '$lib/types/ai-settings';
import { getEngine } from '$lib/server/engine';

/**
 * The last four characters of a key, or fewer for a short one.
 *
 * Enough to tell two keys apart in the picker, not enough to be worth
 * exfiltrating. OpenRouter keys are long, so the branch only fires on a
 * deliberately silly value.
 */
function mask(key: AIKeyRecord): string {
	const tail = key.api_key.slice(-4);
	return key.api_key.length <= 4 ? '*'.repeat(key.api_key.length) : `...${tail}`;
}

/** The full settings state, with the override the process is imposing (if any). */
export function readSettingsState(): AISettingsState {
	const engine = getEngine();
	const resolved = engine.aiSettings.resolve();
	const settings = engine.aiSettings.getSettings();
	const override = readDefaultAIOverride();

	return {
		// What the runtime will do: the override wins over the stored choice, and
		// a dangling selection has already fallen back to mock inside `resolve()`.
		effective_mode: override ? override.provider : resolved.mode,
		stored_mode: settings.ai_mode,
		selected_key_label: settings.ai_key_label,
		selected_model_label: settings.ai_model_label,
		missing_key_label: resolved.missing_key_label,
		missing_model_label: resolved.missing_model_label,
		keys: engine.aiSettings.listKeys().map((key) => ({
			label: key.label,
			source: key.source,
			masked: mask(key)
		})),
		models: engine.aiSettings.listModels().map((model) => ({
			label: model.label,
			model_id: model.model_id,
			source: model.source
		})),
		override: override
			? {
					provider: override.provider,
					model: override.model,
					source: 'AI_PROVIDER / AI_MODEL'
				}
			: null
	};
}

/**
 * Maps a store error to a response.
 *
 * `EnvRowLockedError` is 409 rather than 403: the row exists and the caller is
 * allowed to ask, but its state — owned by a file — conflicts with the edit.
 * `InvalidLabelError` covers both a malformed label and a selection naming
 * something that is not there, which are both the caller's mistake, so 400.
 * Anything else is a real failure and is left to bubble into a 500.
 */
export function settingsError(error: unknown): Response {
	if (error instanceof EnvRowLockedError) {
		return json({ error: error.message }, { status: 409 });
	}
	if (error instanceof InvalidLabelError) {
		return json({ error: error.message }, { status: 400 });
	}
	throw error;
}

/** Reads a JSON body, or null when it is absent or unparseable. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
	const body = await request.json().catch(() => null);
	return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
}
