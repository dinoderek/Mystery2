import { test, expect } from '@playwright/test';

test.describe('US4 - Help Modal', () => {
    test('toggles help modal using command', async ({ page }) => {
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

        await page.goto('/');
        await expect(page.getByText('B1')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page).toHaveURL(/.*\/session/);

        // Type 'help'
        const input = page.locator('input[type="text"]');
        await input.fill('help');
        await input.press('Enter');

        // Modal should appear
        const helpModal = page.locator('text=COMMAND REFERENCE');
        await expect(helpModal).toBeVisible();

        // Close the modal
        await page.locator('button:has-text("[ CLOSE ]")').click();

        // Modal should disappear
        await expect(helpModal).toBeHidden();
    });
});
