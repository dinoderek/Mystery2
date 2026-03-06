import { test, expect } from '@playwright/test';

test.describe('US2 - Status Bar', () => {
    test('displays correct status information (location, hints, time)', async ({ page }) => {
        await page.route('**/functions/v1/blueprints-list', async route => {
            await route.fulfill({ json: { blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }] } });
        });

        await page.route('**/functions/v1/game-start', async route => {
            await route.fulfill({
                json: {
                    game_id: 'g1',
                    state: {
                        locations: [{ name: 'kitchen' }, { name: 'garden' }],
                        characters: [{ first_name: 'Bob', last_name: 'Smith', location_name: 'kitchen' }],
                        time_remaining: 8,
                        location: 'kitchen',
                        mode: 'explore',
                        current_talk_character: null,
                        clues: ['clue1', 'clue2'],
                        narration: 'You enter the kitchen.',
                        history: []
                    }
                }
            });
        });

        await page.goto('/');
        await expect(page.getByText('B1')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page).toHaveURL(/.*\/session/);

        // Verify header/status elements
        await expect(page.locator('text=LOCATION: kitchen')).toBeVisible();
        await expect(page.locator('text=TIME: 8')).toBeVisible();
        await expect(page.locator("text=type 'help' to see commands")).toBeVisible();
        // Ensure character Bob is listed if visible_characters is parsed
        await expect(page.locator('text=Bob')).toBeVisible();
    });
});
