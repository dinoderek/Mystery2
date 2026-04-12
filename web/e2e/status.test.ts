import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameState,
  createNarrationEvent,
} from '../../tests/testkit/src/fixtures';

test.describe('US2 - Status Bar', () => {
    test('displays correct status information (location, hints, time)', async ({ page }) => {
        await enableAuthBypass(page);
        await page.route('**/functions/v1/game-sessions-list*', async route => {
            await route.fulfill({ json: EMPTY_CATALOG });
        });
        await page.route('**/functions/v1/blueprints-list', async route => {
            await route.fulfill({ json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })] } });
        });

        await page.route('**/functions/v1/game-start', async route => {
            await route.fulfill({
                json: {
                    game_id: '00000000-0000-0000-0000-000000000001',
                    state: createGameState({
                        locations: [{ id: 'loc-kitchen', name: 'kitchen' }, { id: 'loc-garden', name: 'garden' }],
                        characters: [
                            { id: 'char-bob', first_name: 'Bob', last_name: 'Smith', location_id: 'loc-kitchen', location_name: 'kitchen', sex: 'male' },
                            { id: 'char-alice', first_name: 'Alice', last_name: 'Brown', location_id: 'loc-garden', location_name: 'garden', sex: 'female' },
                        ],
                        time_remaining: 8,
                        location: 'kitchen',
                    }),
                    narration_events: [
                        createNarrationEvent({
                            narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
                        }),
                    ],
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
