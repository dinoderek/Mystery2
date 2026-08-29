import { expect, type Page } from '@playwright/test';

/**
 * Signing in, for browser tests.
 *
 * This replaces `test-auth.ts`, which created a Supabase auth user through the
 * admin API, signed it in, and — because doing that before every test was slow
 * — offered `signInAsTestProfile()` to skip the gate with a localStorage flag read
 * by the app itself. There is nothing left to bypass: a profile is a name, and
 * creating one is a single request.
 */

function uniqueName(tag: string): string {
	return `${tag}-${crypto.randomUUID().slice(0, 8)}`;
}

export interface TestProfile {
	id: string;
	name: string;
}

/**
 * Creates a profile and leaves its cookie in the page's context, so the app is
 * signed in from the first navigation. Call it before `page.goto()`.
 */
export async function signInAsTestProfile(page: Page, tag = 'e2e'): Promise<TestProfile> {
	const name = uniqueName(tag);
	const response = await page.request.post('/api/player', { data: { name } });
	expect(response.ok(), `failed to create profile ${name}`).toBe(true);

	const { player } = (await response.json()) as { player: TestProfile };
	return player;
}

/** Signs in the way a player does: through the picker on `/login`. */
export async function signInThroughPicker(page: Page, tag = 'e2e-ui'): Promise<string> {
	const name = uniqueName(tag);

	await page.goto('/login');
	await page.locator('#profile-name').fill(name);
	await page.getByRole('button', { name: '[ START ]' }).click();

	await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
	await expect(page.getByText('MYSTERY GAME TERMINAL').first()).toBeVisible();

	return name;
}
