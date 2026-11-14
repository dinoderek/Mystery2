// The AI settings page's state, which the profile picker also reads to name
// the narrator.
//
// A choice returns the whole settings state, so this never patches its own copy
// — it replaces it with what the server says.

import { callApi, callApiGet } from '$lib/api/client';
import type { AISettingsState } from '$lib/types/ai-settings';

export class AISettingsStore {
	state = $state<AISettingsState | null>(null);
	loading = $state(true);
	/** Set while a choice is in flight, so the controls can disable themselves. */
	saving = $state(false);
	error = $state<string | null>(null);

	async load(): Promise<void> {
		this.loading = true;
		const { data, error } = await callApiGet<AISettingsState>('ai-settings');
		this.apply(data, error?.message ?? null);
		this.loading = false;
	}

	/** Chooses `mock` or an AI from `ai.json`. Returns whether the server took it. */
	async choose(name: string): Promise<boolean> {
		this.saving = true;
		const { data, error } = await callApi<AISettingsState>('ai-settings', { name });
		this.apply(data, error?.message ?? null);
		this.saving = false;
		return error === null;
	}

	/**
	 * A failed request keeps the last known state on screen rather than blanking
	 * the page: the choice did not change, so showing nothing would be a bigger
	 * lie than showing it alongside the error.
	 */
	private apply(data: AISettingsState | null, error: string | null): void {
		this.error = error;
		if (!error && data) this.state = data;
	}
}

export const aiSettingsStore = new AISettingsStore();
