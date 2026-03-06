import { test, expect } from '@playwright/test';

test.describe('US1 - Start Screen', () => {
    test('loads blueprints and starts game on numeric key press', async ({ page }) => {
        // Mock blueprints-list
        await page.route('**/functions/v1/blueprints-list', async route => {
            const json = {
                blueprints: [
                    { id: 'bp-1', title: 'The Stolen Cake', one_liner: 'Find the cake', target_age: 6 },
                    { id: 'bp-2', title: 'The Missing Dog', one_liner: 'Find the dog', target_age: 9 }
                ]
            };
            await route.fulfill({ json });
        });

        // Mock game-start
        await page.route('**/functions/v1/game-start', async route => {
            const json = {
                game_id: 'game-123',
                state: {
                    locations: [], characters: [], time_remaining: 10, location: 'living room', mode: 'explore', current_talk_character: null, clues: [], narration: 'Game started.', history: []
                }
            };
            await route.fulfill({ json });
        });

        await page.goto('/');

        // Verify blueprints are displayed
        await expect(page.getByText('The Stolen Cake')).toBeVisible();
        await expect(page.getByText('The Missing Dog')).toBeVisible();

        // Press '1' to select the first blueprint
        await page.keyboard.press('1');

        // Wait for navigation / state change (redirect to /session)
        await expect(page).toHaveURL(/.*\/session/);
    });
});
