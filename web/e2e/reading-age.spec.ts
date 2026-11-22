import { expect, test } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';

// A player sets the reading age on the settings page, against the real server,
// and the next game they start is narrated for it.

const MOCK_BLUEPRINT_ID = '123e4567-e89b-12d3-a456-426614174000';

test.describe('Reading age', () => {
	test('a player sets the age, and the next game reads at it', async ({ page }) => {
		const profile = await signInAsTestProfile(page, 'reading-age');

		// Only the mock case, so the first listed is the one started.
		await page.route('**/api/blueprints-list*', async (route) => {
			const answer = await route.fetch();
			const body = await answer.json();
			body.blueprints = body.blueprints.filter((entry: { id: string }) => entry.id === MOCK_BLUEPRINT_ID);
			await route.fulfill({ response: answer, json: body });
		});

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

		expect(answer.reading_age).toBe(7);
		expect(answer.narration_events[0].narration_parts[0].text).toContain('The reader is 7 ');
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
