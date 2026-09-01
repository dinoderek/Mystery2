import { expect, test } from '@playwright/test';
import { signInAsTestProfile, signInThroughPicker } from './test-profile';

test.describe('Local profiles', () => {
	test('sends a visitor with no profile to the picker', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByText('Who is playing?')).toBeVisible();
	});

	test('refuses an empty name', async ({ page }) => {
		await page.goto('/login');
		await page.getByRole('button', { name: '[ START ]' }).click();

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('alert')).toHaveText('Enter a name');
	});

	test('creating a profile signs in and redirects away from the picker', async ({ page }) => {
		await signInThroughPicker(page);

		await page.goto('/login');
		await expect(page).toHaveURL(/\/$/);
	});

	test('stays signed in across a reload', async ({ page }) => {
		await signInThroughPicker(page);

		await page.reload();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByText('MYSTERY GAME TERMINAL').first()).toBeVisible();
	});

	test('offers an existing profile to pick again after signing out', async ({ page }) => {
		const name = await signInThroughPicker(page, 'returning');

		await page.getByRole('button', { name: /logout|sign out/i }).click();
		await expect(page).toHaveURL(/\/login$/);

		const existing = page.getByTestId('profile-option').filter({ hasText: name });
		await expect(existing).toBeVisible();

		await existing.click();
		await expect(page).toHaveURL(/\/$/);
	});

	test('makes no signed-out API calls on the way to the picker', async ({ page }) => {
		// The landing page used to render for a tick before `goto('/login')`
		// resolved, and its `onMount` fired `game-sessions-list` without a
		// profile. The 401 that came back left "Session catalog unavailable" on
		// the menu after signing in.
		const unauthenticated: string[] = [];
		page.on('response', (response) => {
			if (response.status() === 401) unauthenticated.push(response.url());
		});

		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByText('Who is playing?')).toBeVisible();

		expect(unauthenticated).toEqual([]);
	});

	test('shows a working session catalog straight after signing in', async ({ page }) => {
		await signInThroughPicker(page, 'catalog');

		await expect(page.getByText(/Session catalog unavailable/)).toHaveCount(0);
		await expect(page.getByText('2. View in-progress games')).toBeVisible();
	});

	test('signs in without the picker when the cookie is already set', async ({ page }) => {
		await signInAsTestProfile(page);

		await page.goto('/');
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByText('MYSTERY GAME TERMINAL').first()).toBeVisible();
	});
});
