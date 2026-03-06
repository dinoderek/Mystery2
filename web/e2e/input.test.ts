import { test, expect } from '@playwright/test';

test.describe('US3 - Command Input', () => {
    test('submits command and displays result', async ({ page }) => {
        await page.route('**/functions/v1/blueprints-list', async route => {
            await route.fulfill({ json: { blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }] } });
        });

        await page.route('**/functions/v1/game-start', async route => {
            await route.fulfill({
                json: {
                    game_id: 'g1',
                    state: {
                        locations: [], characters: [], time_remaining: 10, location: 'kitchen', mode: 'explore', current_talk_character: null, clues: [],
                        narration: 'You enter the kitchen.', history: []
                    }
                }
            });
        });

        await page.route('**/functions/v1/game-search/*', async route => {
            await route.fulfill({
                json: {
                    narration: 'You search and find nothing.',
                    discovered_clue_id: null,
                    time_remaining: 9
                }
            });
        });

        await page.goto('/');
        await expect(page.getByText('B1')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page).toHaveURL(/.*\/session/);

        // Verify input box exists and is focused
        const input = page.locator('input[type="text"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await expect(input).toHaveAttribute('placeholder', /> Explore mode\.\.\./);

        // Type and submit command
        await input.fill('search room');
        await input.press('Enter');

        // Should see the search result narration
        await expect(page.locator('text="You search and find nothing."')).toBeVisible();
        // Input should be cleared
        await expect(input).toHaveValue('');
    });
});
