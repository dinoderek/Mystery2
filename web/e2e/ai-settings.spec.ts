import { expect, test } from '@playwright/test';

// The settings page in a real browser. What matters here is that it works
// *before* a profile exists — the page in front of the picker is the one a
// player reaches when the AI configuration is what is stopping them — and that
// getting to it costs no signed-out API calls.
//
// The settings row is a singleton by design — it is a property of the
// installation, not of a player — so these tests cannot be isolated from each
// other the way the rest of the suite is. They run serially against the shared
// row, and each puts the mode back to mock and removes what it added. The rest
// of the suite still runs in parallel alongside them; nothing else touches
// these tables.

const KEY_LABEL = 'e2e-key';
const MODEL_LABEL = 'e2e-model';

async function resetSettings(request: {
	post: (url: string, options: { data: unknown }) => Promise<unknown>;
	delete: (url: string) => Promise<unknown>;
}) {
	await request.post('/api/ai-settings', { data: { mode: 'mock' } });
	await request.post('/api/ai-settings', { data: { key_label: null, model_label: null } });
	await request.delete(`/api/ai-settings/keys?label=${KEY_LABEL}`);
	await request.delete(`/api/ai-settings/models?label=${MODEL_LABEL}`);
}

test.describe('AI settings', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ request }) => {
		await resetSettings(request);
	});

	test.afterEach(async ({ request }) => {
		await resetSettings(request);
	});

	test('is reachable from the picker without a profile', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);

		await page.getByTestId('settings-link').click();

		await expect(page).toHaveURL(/\/settings$/);
		await expect(page.getByRole('heading', { name: 'AI SETTINGS' })).toBeVisible();
	});

	test('renders when opened directly, signed out, with no 401s', async ({ page }) => {
		// The layout gate sends every other route to the picker. If `/settings`
		// were not on the public list this would redirect, and if it rendered
		// without being public its fetch would come back 401.
		const unauthenticated: string[] = [];
		page.on('response', (response) => {
			if (response.status() === 401) unauthenticated.push(response.url());
		});

		await page.goto('/settings');

		await expect(page).toHaveURL(/\/settings$/);
		await expect(page.getByRole('heading', { name: 'AI SETTINGS' })).toBeVisible();
		expect(unauthenticated).toEqual([]);
	});

	test('goes back to the picker', async ({ page }) => {
		await page.goto('/settings');
		await page.getByRole('button', { name: '[ BACK ]' }).click();

		await expect(page).toHaveURL(/\/login$/);
	});

	test('refuses real AI until a key and a model are chosen', async ({ page }) => {
		await page.goto('/settings');
		await page.getByTestId('mode-openrouter').click();

		await expect(page.getByRole('alert')).toContainText(/key and a model/i);
		await expect(page.getByTestId('mode-mock')).toHaveAttribute('aria-pressed', 'true');
	});

	test('stores a key and a model, and the choice survives a reload', async ({ page }) => {
		await page.goto('/settings');

		await page.getByLabel('New key label').fill(KEY_LABEL);
		await page.getByLabel('New key value').fill('sk-or-v1-abcdefgh1234');
		await page.getByRole('button', { name: '[ SAVE KEY ]' }).click();

		await page.getByLabel('New model label').fill(MODEL_LABEL);
		await page.getByLabel('New model ID').fill('vendor/some-model');
		await page.getByRole('button', { name: '[ SAVE MODEL ]' }).click();

		// Only the last four characters of the key are ever sent to the browser.
		await expect(page.getByTestId('key-option')).toContainText('...1234');
		await expect(page.getByTestId('key-option')).not.toContainText('abcdefgh');

		await page.getByTestId('key-option').click();
		await page.getByTestId('model-option').click();
		await page.getByTestId('mode-openrouter').click();

		await expect(page.getByTestId('mode-openrouter')).toHaveAttribute('aria-pressed', 'true');

		await page.reload();

		await expect(page.getByTestId('mode-openrouter')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('key-option')).toHaveAttribute('aria-pressed', 'true');
	});

	test('deleting the selected model steps the mode back to mock', async ({ page, request }) => {
		await request.post('/api/ai-settings/keys', {
			data: { label: KEY_LABEL, api_key: 'sk-or-v1-abcdefgh1234' }
		});
		await request.post('/api/ai-settings/models', {
			data: { label: MODEL_LABEL, model_id: 'vendor/some-model' }
		});
		await request.post('/api/ai-settings', {
			data: { mode: 'openrouter', key_label: KEY_LABEL, model_label: MODEL_LABEL }
		});

		await page.goto('/settings');
		await expect(page.getByTestId('mode-openrouter')).toHaveAttribute('aria-pressed', 'true');

		await page.getByTestId('delete-model').click();

		await expect(page.getByTestId('mode-mock')).toHaveAttribute('aria-pressed', 'true');
	});
});
