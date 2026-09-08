// The AI settings page's state.
//
// Every mutation returns the whole settings state, so this never patches its
// own copy from a request body — it replaces it with what the server says. That
// removes the class of bug where the page and the database disagree after a
// write the server adjusted (a delete that stepped the mode back to mock, say).

import { callApi, callApiDelete, callApiGet } from '$lib/api/client';
import type { AIMode, AISettingsState } from '$lib/types/ai-settings';

export class AISettingsStore {
	state = $state<AISettingsState | null>(null);
	loading = $state(true);
	/** Set while a write is in flight, so the controls can disable themselves. */
	saving = $state(false);
	error = $state<string | null>(null);

	async load(): Promise<void> {
		this.loading = true;
		const { data, error } = await callApiGet<AISettingsState>('ai-settings');
		this.apply(data, error?.message ?? null);
		this.loading = false;
	}

	async setMode(mode: AIMode): Promise<void> {
		await this.write(() => callApi<AISettingsState>('ai-settings', { mode }));
	}

	async selectKey(label: string | null): Promise<void> {
		await this.write(() => callApi<AISettingsState>('ai-settings', { key_label: label }));
	}

	async selectModel(label: string | null): Promise<void> {
		await this.write(() => callApi<AISettingsState>('ai-settings', { model_label: label }));
	}

	async addKey(label: string, apiKey: string): Promise<boolean> {
		return this.write(() =>
			callApi<AISettingsState>('ai-settings/keys', { label, api_key: apiKey })
		);
	}

	async addModel(label: string, modelId: string): Promise<boolean> {
		return this.write(() =>
			callApi<AISettingsState>('ai-settings/models', { label, model_id: modelId })
		);
	}

	async deleteKey(label: string): Promise<boolean> {
		return this.write(() => callApiDelete<AISettingsState>('ai-settings/keys', { label }));
	}

	async deleteModel(label: string): Promise<boolean> {
		return this.write(() => callApiDelete<AISettingsState>('ai-settings/models', { label }));
	}

	/**
	 * Runs one write and adopts the state it returns.
	 *
	 * Returns whether it succeeded, which the forms use to decide whether to
	 * clear their inputs — a rejected key should stay in the box to be fixed,
	 * not vanish.
	 */
	private async write(
		request: () => Promise<{ data: AISettingsState | null; error: { message: string } | null }>
	): Promise<boolean> {
		this.saving = true;
		const { data, error } = await request();
		this.apply(data, error?.message ?? null);
		this.saving = false;
		return error === null;
	}

	/**
	 * A failed request keeps the last known state on screen rather than blanking
	 * the page: the settings did not change, so showing nothing would be a
	 * bigger lie than showing them alongside the error.
	 */
	private apply(data: AISettingsState | null, error: string | null): void {
		this.error = error;
		if (!error && data) this.state = data;
	}
}

export const aiSettingsStore = new AISettingsStore();
