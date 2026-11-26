// The playing profile's settings, as the settings page shows them: today, the
// reading age its games are written at.
//
// Like the AI settings, a change returns the whole state, so this never patches
// its own copy. Only a signed-in page calls it: the endpoint runs as a profile.

import { ProfileSettingsSchema, type ProfileSettings } from '@my2/shared';
import { callApi, callApiGet, type ApiResult } from '$lib/api/client';
import { readAnswer } from './contract';

export class ProfileSettingsStore {
	state = $state<ProfileSettings | null>(null);
	loading = $state(true);
	/** Set while a change is in flight, so the controls can disable themselves. */
	saving = $state(false);
	error = $state<string | null>(null);

	async load(): Promise<void> {
		this.loading = true;
		this.apply(await callApiGet('profile-settings'));
		this.loading = false;
	}

	/** Sets the reading age, or clears it with null. Returns whether the server took it. */
	async setReadingAge(age: number | null): Promise<boolean> {
		this.saving = true;
		const ok = this.apply(await callApi('profile-settings', { reading_age: age }));
		this.saving = false;
		return ok;
	}

	/** A failed request keeps the last known state on screen, beside the error. */
	private apply(result: ApiResult): boolean {
		const answer = readAnswer(result, ProfileSettingsSchema, 'profile-settings');
		if (!answer.ok) {
			this.error = answer.message;
			return false;
		}
		this.error = null;
		this.state = answer.value;
		return true;
	}
}

export const profileSettingsStore = new ProfileSettingsStore();
