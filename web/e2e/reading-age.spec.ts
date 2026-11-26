import { expect, test } from '@playwright/test';
import { listOnlyMockCase } from './session-helpers';
import { signInAsTestProfile } from './test-profile';

// A player sets the reading age on the settings page, against the real server,
// and the next game they start is written at it.

test.describe('Reading age', () => {
	test('a player sets the age, and the next game is written at it', async ({ page }) => {
		const profile = await signInAsTestProfile(page, 'reading-age');

		await listOnlyMockCase(page);

		await page.goto('/');
		await page.getByTestId('settings-link').click();
		await expect(page).toHaveURL(/\/settings$/);

		const section = page.getByTestId('reading-age');
		await expect(section).toContainText(`READING AGE FOR ${profile.name.toUpperCase()}`);
		const caseOwn = section.locator('[data-age="case"]');
		const seven = section.locator('[data-age="7"]');
		await expect(caseOwn).toHaveAttribute('aria-pressed', 'true');

		await seven.click();
		await expect(seven).toHaveAttribute('aria-pressed', 'true');
		await expect(caseOwn).toHaveAttribute('aria-pressed', 'false');

		// Kept across a reload: the server holds it, not the page.
		await page.reload();
		await expect(page.getByTestId('reading-age').locator('[data-age="7"]')).toHaveAttribute('aria-pressed', 'true');

		await page.getByRole('button', { name: '[ BACK ]' }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByText('1. Start a new game')).toBeVisible();
		await page.keyboard.press('1');
		await expect(page.getByText('Target age: 10')).toBeVisible();

		const started = page.waitForResponse('**/api/game-start');
		await page.keyboard.press('1');
		const answer = await (await started).json();

		// That every prompt is written for it is the integration suite's (`tests/api/integration/reading-age.test.ts`).
		expect(answer.reading_age).toBe(7);
		expect(answer.narration_events[0].payload.reading_age).toBe(7);
		await expect(page).toHaveURL(/\/session/);
	});

	test('a signed-out visitor sees no reading age and makes no profile call', async ({ page }) => {
		const profileCalls: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes('/api/profile-settings')) profileCalls.push(request.url());
		});

		await page.goto('/settings');
		await expect(page.getByRole('heading', { name: 'AI SETTINGS' })).toBeVisible();
		await expect(page.getByTestId('reading-age')).toHaveCount(0);
		expect(profileCalls).toEqual([]);
	});
});
