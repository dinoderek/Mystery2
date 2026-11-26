import { expect, type Page } from '@playwright/test';

/**
 * Signing in, for browser tests.
 *
 * A profile is a name and creating one is a single request, so tests sign in
 * the way a player does. There is no bypass, because there is nothing slow
 * enough to be worth bypassing.
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
export async function signInAsTestProfile(page: Page, tag = 'e2e', readingAge = 8): Promise<TestProfile> {
	const name = uniqueName(tag);
	const response = await page.request.post('/api/player', { data: { name, reading_age: readingAge } });
	expect(response.ok(), `failed to create profile ${name}`).toBe(true);

	const { player } = (await response.json()) as { player: TestProfile };
	return player;
}

/** Signs in the way a player does: through the picker on `/login`. */
export async function signInThroughPicker(page: Page, tag = 'e2e-ui', readingAge = 8): Promise<string> {
	const name = uniqueName(tag);

	await page.goto('/login');
	await page.locator('#profile-name').fill(name);
	await page.locator(`[data-testid="reading-age-option"][data-age="${readingAge}"]`).click();
	await page.getByRole('button', { name: '[ START ]' }).click();

	await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
	await expect(page.getByText('MYSTERY GAME TERMINAL').first()).toBeVisible();

	return name;
}

/** What the engine answers, byte for byte, a profile that has no reading age (`tests/api/integration/reading-age.test.ts`). */
const AGE_REQUIRED = {
	status: 400,
	json: { error: 'Choose a reading age before playing', details: { code: 'READING_AGE_REQUIRED' } },
};

/**
 * Makes the first request to `endpoint` (matching `method`) answer as it does for
 * a profile with no reading age, and lets the rest through to the real server.
 *
 * The run's database cannot be reached from a spec: Playwright starts the
 * server before `global-setup.ts` empties the database, so the server holds
 * files that no longer have a path. The refusal itself is the integration
 * suite's; the browser's answer to it is this one's.
 */
export async function refuseOnceForWantOfAge(page: Page, endpoint: string, method = 'POST'): Promise<void> {
	let refused = false;
	await page.route(`**/api/${endpoint}*`, async (route) => {
		if (!refused && route.request().method() === method) {
			refused = true;
			await route.fulfill(AGE_REQUIRED);
			return;
		}
		await route.continue();
	});
}
