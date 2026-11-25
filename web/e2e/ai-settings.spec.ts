import { expect, test, type Page } from '@playwright/test';

// The settings page and the picker's narrator line in a real browser. The page
// works *before* a profile exists — the page in front of the picker is the one
// a player reaches when the chosen AI is what is stopping them — and getting to
// it costs no signed-out API calls.
//
// The choice is a singleton by design — a property of the installation, not of
// a player — and the rest of the suite plays games on the same server in
// parallel. This server has no ai.json, so mock is all it can choose, and each
// test puts the choice back to mock. Lists with real AIs, the override banner
// and a missing AI are shown by answering the page's request in the browser
// (`showState`), so nothing here ever reaches the server's choice.

const MOCK = { name: 'mock', backend: 'mock', model: 'mock/runtime-default', problem: null };

/** Answers the page's settings request with `state`, in this browser only. */
async function showState(page: Page, state: Record<string, unknown>) {
	await page.route('**/api/ai-settings', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({
					json: {
						ais: [MOCK],
						chosen: null,
						override: null,
						narrator: { name: 'mock', backend: 'mock', model: 'mock/runtime-default' },
						narrator_error: null,
						...state
					}
				})
			: route.continue()
	);
}

test.describe('AI settings', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ request }) => {
		await request.post('/api/ai-settings', { data: { name: 'mock' } });
	});

	test.afterEach(async ({ request }) => {
		await request.post('/api/ai-settings', { data: { name: 'mock' } });
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

	test('chooses mock, and the choice survives a reload', async ({ page }) => {
		await page.goto('/settings');
		const mock = page.locator('[data-testid="ai-option"][data-name="mock"]');

		await mock.click();
		await expect(mock).toHaveAttribute('aria-pressed', 'true');

		await page.reload();

		await expect(mock).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('narrator')).toContainText('NARRATOR: mock');
	});

	test('the picker names mock as the narrator', async ({ page }) => {
		await page.goto('/login');

		await expect(page.getByTestId('narrator')).toContainText('NARRATOR: mock');
	});

	test('lists the AIs with backend and model, marks the choice, and shows no key', async ({ page }) => {
		await showState(page, {
			ais: [
				MOCK,
				{ name: 'luna6', backend: 'openrouter', model: 'openai/gpt-6-luna', problem: null },
				{
					name: 'free',
					backend: 'openrouter',
					model: 'vendor/free',
					problem: 'AI "free" uses openrouter but has no key'
				}
			],
			chosen: 'luna6',
			narrator: { name: 'luna6', backend: 'openrouter', model: 'openai/gpt-6-luna' }
		});

		await page.goto('/settings');

		const luna = page.locator('[data-testid="ai-option"][data-name="luna6"]');
		await expect(luna).toContainText('openrouter / openai/gpt-6-luna');
		await expect(luna).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('[data-testid="ai-option"][data-name="mock"]')).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		// Listed, but not choosable, with the reason beside it.
		await expect(page.locator('[data-testid="ai-option"][data-name="free"]')).toBeDisabled();
		await expect(page.getByTestId('ai-problem')).toContainText('has no key');
		await expect(page.getByTestId('override-banner')).toHaveCount(0);
		await expect(page.getByText('sk-or')).toHaveCount(0);
	});

	test('shows a banner naming the run override', async ({ page }) => {
		await showState(page, {
			override: { name: 'claude', backend: 'claude-cli', model: 'sonnet' },
			narrator: { name: 'claude', backend: 'claude-cli', model: 'sonnet' }
		});

		await page.goto('/settings');

		await expect(page.getByTestId('override-banner')).toContainText('--ai claude');
		await expect(page.getByTestId('narrator')).toContainText('NARRATOR: claude');
	});

	test('the picker says nothing narrates when the chosen AI has gone', async ({ page }) => {
		await showState(page, {
			chosen: 'luna6',
			narrator: null,
			narrator_error: 'The AI chosen on the settings page, "luna6", is not in ai.json.'
		});

		await page.goto('/login');

		await expect(page.getByTestId('narrator')).toContainText('NO NARRATOR');
		await expect(page.getByTestId('narrator')).toContainText('"luna6"');
	});
});
