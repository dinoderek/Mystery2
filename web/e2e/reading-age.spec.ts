import { expect, test } from '@playwright/test';
import { listOnlyMockCase } from './session-helpers';
import { refuseOnceForWantOfAge, signInAsTestProfile } from './test-profile';

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
		const eight = section.locator('[data-age="8"]');
		const seven = section.locator('[data-age="7"]');
		await expect(eight).toHaveAttribute('aria-pressed', 'true');
		// A profile always has an age, so there is no "each case's own" to fall back to.
		await expect(section.getByText("EACH CASE'S OWN")).toHaveCount(0);
		await expect(section.locator('[data-age="case"]')).toHaveCount(0);

		await seven.click();
		await expect(seven).toHaveAttribute('aria-pressed', 'true');
		await expect(eight).toHaveAttribute('aria-pressed', 'false');

		// Kept across a reload: the server holds it, not the page.
		await page.reload();
		await expect(page.getByTestId('reading-age').locator('[data-age="7"]')).toHaveAttribute('aria-pressed', 'true');

		await page.getByRole('button', { name: '[ BACK ]' }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByText('1. Start a new game')).toBeVisible();
		await page.keyboard.press('1');
		await expect(page.getByTestId('case-card-1')).toBeVisible();
		// A case has no age of its own, so the menu shows none.
		await expect(page.getByText(/Target age/)).toHaveCount(0);

		const started = page.waitForResponse('**/api/game-start');
		await page.keyboard.press('1');
		const answer = await (await started).json();

		// That every prompt is written for it is the integration suite's (`tests/api/integration/reading-age.test.ts`).
		expect(answer.reading_age).toBe(7);
		expect(answer.narration_events[0].payload.reading_age).toBe(7);
		await expect(page).toHaveURL(/\/session/);
	});

	test('typing age mid-game shows one line, and the game carries on at the new age', async ({ page }) => {
		await signInAsTestProfile(page, 'age-command');
		await listOnlyMockCase(page);

		await page.goto('/');
		await expect(page.getByText('1. Start a new game')).toBeVisible();
		await page.keyboard.press('1');
		await expect(page.getByTestId('case-card-1')).toBeVisible();
		await page.keyboard.press('1');
		await expect(page).toHaveURL(/\/session/);
		await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
		await page.keyboard.press('Enter');

		const input = page.locator("input[type='text']");
		const line = page.getByText('From now on, the story is written for age 9.');

		await input.fill('age 9');
		await input.press('Enter');
		await expect(line).toBeVisible();

		const played = page.waitForResponse('**/api/game-turn');
		await input.fill('search');
		await input.press('Enter');
		const turn = await (await played).json();

		expect(turn.events[0].payload.reading_age).toBe(9);
		await expect(page.getByText(/\[Mock\]/).last()).toBeVisible();
		await expect(line).toHaveCount(1);

		// Reopened, the game says the same once.
		await page.reload();
		await expect(page.getByText('2. View in-progress games')).toBeVisible();
		await page.keyboard.press('2');
		await expect(page.getByText('Mock Case')).toBeVisible();
		await page.keyboard.press('1');
		await expect(line).toHaveCount(1);
	});

	test('a profile with no age is asked for one before its game starts, then plays', async ({ page }) => {
		await signInAsTestProfile(page, 'ageless');
		await refuseOnceForWantOfAge(page, 'game-start');
		await listOnlyMockCase(page);

		await page.goto('/');
		await expect(page.getByText('1. Start a new game')).toBeVisible();
		await page.keyboard.press('1');
		await expect(page.getByTestId('case-card-1')).toBeVisible();

		const refused = page.waitForResponse('**/api/game-start');
		await page.keyboard.press('1');
		expect((await refused).status()).toBe(400);

		const prompt = page.getByTestId('reading-age-prompt');
		await expect(prompt).toBeVisible();
		await expect(page).toHaveURL(/\/$/);

		const started = page.waitForResponse((response) => response.url().includes('/api/game-start') && response.ok());
		await prompt.locator('[data-age="9"]').click();
		const game = await (await started).json();

		expect(game.reading_age).toBe(9);
		await expect(page).toHaveURL(/\/session/);
		await expect(prompt).toHaveCount(0);
	});

	test('an ageless profile\'s settings page asks for an age too', async ({ page }) => {
		await signInAsTestProfile(page, 'ageless-settings');
		await refuseOnceForWantOfAge(page, 'profile-settings', 'GET');

		await page.goto('/settings');
		const section = page.getByTestId('reading-age');
		await expect(section).toContainText('no reading age yet');
		await expect(section.locator('[aria-pressed="true"]')).toHaveCount(0);

		await section.locator('[data-age="10"]').click();
		await expect(section.locator('[data-age="10"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(section).not.toContainText('no reading age yet');
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
