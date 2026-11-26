// The playing profile's settings, as the settings page shows them: today, the
// reading age its games are written at.
//
// Like the AI settings, a change returns the whole state, so this never patches
// its own copy. Only a signed-in page calls it: the endpoint runs as a profile.

import { ProfileSettingsSchema, READING_AGE_REQUIRED, type ProfileSettings } from '@my2/shared';
import { callApi, callApiGet, type ApiResult } from '$lib/api/client';
import { readAnswer } from './contract';

export class ProfileSettingsStore {
	state = $state<ProfileSettings | null>(null);
	loading = $state(true);
	/** Set while a change is in flight, so the controls can disable themselves. */
	saving = $state(false);
	/** The profile has no reading age yet (an older local database): the page asks for one. */
	missing = $state(false);
	error = $state<string | null>(null);

	async load(): Promise<void> {
		this.loading = true;
		this.apply(await callApiGet('profile-settings'));
		this.loading = false;
	}

	/** Sets the reading age. Returns whether the server took it. */
	async setReadingAge(age: number): Promise<boolean> {
		this.saving = true;
		const ok = this.apply(await callApi('profile-settings', { reading_age: age }));
		this.saving = false;
		return ok;
	}

	/** A failed request keeps the last known state on screen, beside the error. */
	private apply(result: ApiResult): boolean {
		if (result.error?.code === READING_AGE_REQUIRED) {
			this.missing = true;
			this.error = null;
			return false;
		}
		const answer = readAnswer(result, ProfileSettingsSchema, 'profile-settings');
		if (!answer.ok) {
			this.error = answer.message;
			return false;
		}
		this.error = null;
		this.missing = false;
		this.state = answer.value;
		return true;
	}
}

export const profileSettingsStore = new ProfileSettingsStore();
