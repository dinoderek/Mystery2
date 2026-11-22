import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, getMock } = vi.hoisted(() => ({
	postMock: vi.fn(),
	getMock: vi.fn(),
}));

vi.mock('$lib/api/client', () => ({
	callApi: postMock,
	callApiGet: getMock,
}));

import { ProfileSettingsStore } from './profile-settings-store.svelte';
import { createProfileSettings } from '../../../../tests/testkit/src/fixtures';

const ok = (data: unknown) => ({ data, error: null });
const failed = (message: string) => ({ data: null, error: { message } });

beforeEach(() => {
	postMock.mockReset();
	getMock.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ProfileSettingsStore', () => {
	it('loads what the profile has set', async () => {
		const store = new ProfileSettingsStore();
		getMock.mockResolvedValue(ok(createProfileSettings({ reading_age: 9 })));

		await store.load();

		expect(getMock).toHaveBeenCalledWith('profile-settings');
		expect(store.state).toEqual({ reading_age: 9 });
		expect(store.loading).toBe(false);
		expect(store.error).toBeNull();
	});

	it('sets and clears the age, adopting what the server answers', async () => {
		const store = new ProfileSettingsStore();
		postMock.mockResolvedValueOnce(ok(createProfileSettings({ reading_age: 10 })));
		postMock.mockResolvedValueOnce(ok(createProfileSettings()));

		expect(await store.setReadingAge(10)).toBe(true);
		expect(postMock).toHaveBeenLastCalledWith('profile-settings', { reading_age: 10 });
		expect(store.state).toEqual({ reading_age: 10 });

		expect(await store.setReadingAge(null)).toBe(true);
		expect(postMock).toHaveBeenLastCalledWith('profile-settings', { reading_age: null });
		expect(store.state).toEqual({ reading_age: null });
		expect(store.saving).toBe(false);
	});

	it('keeps the last state beside the error when a change is refused', async () => {
		const store = new ProfileSettingsStore();
		getMock.mockResolvedValue(ok(createProfileSettings({ reading_age: 7 })));
		await store.load();
		postMock.mockResolvedValue(failed('Invalid reading_age'));

		expect(await store.setReadingAge(12)).toBe(false);

		expect(store.state).toEqual({ reading_age: 7 });
		expect(store.error).toBe('Invalid reading_age');
	});

	it('refuses an answer in a shape it cannot read', async () => {
		const store = new ProfileSettingsStore();
		getMock.mockResolvedValue(ok({ reading_age: 'nine' }));

		await store.load();

		expect(store.state).toBeNull();
		expect(store.error).toMatch(/reading_age/);
	});
});
