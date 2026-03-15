import { expect, test } from '@playwright/test';
import { loginWithSeedUser, resolvePreferredLogin } from './test-auth';

test.describe('Auth flow', () => {
	test('redirects unauthenticated users to /login and validates required fields', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);

		await page.getByRole('button', { name: '[ LOGIN ]' }).click();
		await expect(page.getByText('Email is required')).toBeVisible();
		await expect(page.getByText('Password is required')).toBeVisible();
	});

	test('logs in with valid credentials and redirects authenticated users away from /login', async ({ page }) => {
		await loginWithSeedUser(page);

		await page.goto('/login');
		await expect(page).toHaveURL(/\/$/);
	});

	test('shows an error on invalid credentials', async ({ page }) => {
		const { email } = resolvePreferredLogin();

		await page.goto('/login');
		await page.locator('#email').fill(email);
		await page.locator('#password').fill('definitely-wrong');
		await page.getByRole('button', { name: '[ LOGIN ]' }).click();

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
	});

	test('persists session across reload and remains authenticated after refresh', async ({ page }) => {
		await loginWithSeedUser(page);
		await page.reload();
		await expect(page).toHaveURL(/\/$/);

		const refresh = await page.evaluate(async () => {
			const { supabase } = await import('/src/lib/api/supabase.ts');
			const { data, error } = await supabase.auth.refreshSession();
			return {
				error: error?.message ?? null,
				hasSession: Boolean(data.session),
			};
		});

		expect(refresh.error).toBeNull();
		expect(refresh.hasSession).toBe(true);
		await expect(page).toHaveURL(/\/$/);
	});

	test('redirects to /login with a session-expired message when refresh token is invalid', async ({ page }) => {
		await loginWithSeedUser(page);

		await page.route('**/auth/v1/token?*grant_type=refresh_token*', async (route) => {
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({
					error: 'invalid_grant',
					error_description: 'Invalid Refresh Token: Refresh Token Not Found',
				}),
			});
		});

		const refresh = await page.evaluate(async () => {
			const { supabase } = await import('/src/lib/api/supabase.ts');
			const { error } = await supabase.auth.refreshSession();
			if (error) {
				await supabase.auth.signOut();
			}
			return { error: error?.message ?? null };
		});

		expect(refresh.error).toBeTruthy();
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByText('Session expired, please sign in again')).toBeVisible();
	});

	test('logs out and protects / and /session routes', async ({ page }) => {
		await loginWithSeedUser(page);

		await page.getByRole('button', { name: 'LOGOUT' }).click();
		await expect(page).toHaveURL(/\/login$/);

		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);

		await page.goto('/session');
		await expect(page).toHaveURL(/\/login$/);
	});
});
