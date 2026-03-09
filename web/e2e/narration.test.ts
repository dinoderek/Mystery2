import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

test.describe('US2 - Narration Rendering', () => {
    test('renders narration history and auto-scrolls down', async ({ page }) => {
        await enableAuthBypass(page);
        await page.route('**/functions/v1/blueprints-list', async route => {
            await route.fulfill({ json: { blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }] } });
        });

        await page.route('**/functions/v1/game-start', async route => {
            await route.fulfill({
                json: {
                    game_id: 'g1',
                    state: {
                        locations: [], characters: [], time_remaining: 10, location: 'kitchen', mode: 'explore', current_talk_character: null, clues: [],
                        narration: 'You enter the kitchen.',
                        history: [
                            { sequence: 1, event_type: 'start', actor: 'system', narration: 'Game started. The cake is gone.' },
                            { sequence: 2, event_type: 'move', actor: 'system', narration: 'You enter the kitchen.' }
                        ]
                    }
                }
            });
        });

        await page.goto('/');
        await expect(page.getByText('B1')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page).toHaveURL(/.*\/session/);

        // Should see both history messages rendered
        await expect(page.locator('text="Game started. The cake is gone."')).toBeVisible();
        await expect(page.locator('text="You enter the kitchen."').nth(1)).toBeVisible();

        // Check if the scrollable area exists and verify initial scroll
        const scrollArea = page.locator('.overflow-y-auto');
        await expect(scrollArea).toBeAttached();

        // Add enough messages to force a scroll
        await page.locator('input').fill('move to garden');
        await page.locator('input').press('Enter');

        // Wait for smooth scroll
        await page.waitForTimeout(500);

        // Verify it is scrolled near the bottom
        const scrollInfo = await scrollArea.evaluate((node) => {
            return {
                scrollTop: node.scrollTop,
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight
            };
        });

        // The scrollTop + clientHeight should be very close to scrollHeight
        expect(scrollInfo.scrollTop + scrollInfo.clientHeight).toBeGreaterThanOrEqual(scrollInfo.scrollHeight - 5);
    });
});
