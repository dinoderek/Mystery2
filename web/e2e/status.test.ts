import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

test.describe('US2 - Status Bar', () => {
    test('displays correct status information (location, hints, time)', async ({ page }) => {
        await enableAuthBypass(page);
        await page.route('**/functions/v1/game-sessions-list*', async route => {
            await route.fulfill({
                json: {
                    in_progress: [],
                    completed: [],
                    counts: { in_progress: 0, completed: 0 }
                }
            });
        });
        await page.route('**/functions/v1/blueprints-list', async route => {
            await route.fulfill({ json: { blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }] } });
        });

        await page.route('**/functions/v1/game-start', async route => {
            await route.fulfill({
                json: {
                    game_id: 'g1',
                    state: {
                        locations: [{ name: 'kitchen' }, { name: 'garden' }],
                        characters: [
                            { first_name: 'Bob', last_name: 'Smith', location_name: 'kitchen' },
                            { first_name: 'Alice', last_name: 'Brown', location_name: 'garden' }
                        ],
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
        await expect(page.getByText('1. Start a new game')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page.getByText('B1')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page).toHaveURL(/.*\/session/);

        // Verify header/status elements
        await expect(page.locator('text=LOCATION: kitchen')).toBeVisible();
        await expect(page.locator('text=TIME: 8')).toBeVisible();
        await expect(page.locator("text=type 'help' to see commands")).toBeVisible();
        // Only characters in the current location should be shown.
        await expect(page.locator('text=Bob Smith')).toBeVisible();
        await expect(page.locator('text=Alice Brown')).toHaveCount(0);
    });
});
