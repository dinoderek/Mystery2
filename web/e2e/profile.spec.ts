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

	test('signs in without the picker when the cookie is already set', async ({ page }) => {
		await signInAsTestProfile(page);

		await page.goto('/');
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByText('MYSTERY GAME TERMINAL').first()).toBeVisible();
	});
});
