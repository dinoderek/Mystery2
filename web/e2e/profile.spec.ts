import { expect, test } from '@playwright/test';
import { openNewProfileForm, signInAsTestProfile, signInThroughPicker } from './test-profile';

test.describe('Local profiles', () => {
	test('sends a visitor with no profile to the picker', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByTestId('new-profile').or(page.locator('#profile-name'))).toBeVisible();
	});

	test('refuses an empty name', async ({ page }) => {
		await page.goto('/login');
		await openNewProfileForm(page);
		await page.getByRole('button', { name: '[ START ]' }).click();

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('alert')).toHaveText('Enter a name');
	});

	test('asks a new profile for its reading age, and keeps it', async ({ page }) => {
		await page.goto('/login');
		await openNewProfileForm(page);
		await page.locator('#profile-name').fill('needs-an-age');
		await page.getByRole('button', { name: '[ START ]' }).click();

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('alert')).toHaveText('Choose a reading age');

		await page.getByTestId('reading-age-select').selectOption('10');
		await page.getByRole('button', { name: '[ START ]' }).click();
		await expect(page).toHaveURL(/\/$/);

		const settings = await page.request.get('/api/profile-settings');
		expect(await settings.json()).toEqual({ reading_age: 10 });
	});

	test('refuses a new profile without an age over the API, and signs a known one in without', async ({ page }) => {
		const name = `api-age-${crypto.randomUUID().slice(0, 8)}`;

		const missing = await page.request.post('/api/player', { data: { name } });
		expect(missing.status()).toBe(400);
		const outOfRange = await page.request.post('/api/player', { data: { name, reading_age: 12 } });
		expect(outOfRange.status()).toBe(400);
		expect((await outOfRange.json()).error).toMatch(/reading_age/);

		expect((await page.request.post('/api/player', { data: { name, reading_age: 7 } })).ok()).toBe(true);
		expect((await page.request.post('/api/player', { data: { name } })).ok()).toBe(true);
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
		await expect(page.getByTestId('menu-row-1')).toBeVisible();
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
		await expect(page.getByTestId('new-profile').or(page.locator('#profile-name'))).toBeVisible();

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
		await expect(page.getByTestId('menu-row-1')).toBeVisible();
	});
});
