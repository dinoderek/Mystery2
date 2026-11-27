import { test, expect } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import { confirmOpening, playedTurn, stubTurns } from './session-helpers';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameState,
  createGameStartResponse,
  createNarrationEvent,
} from '../../tests/testkit/src/fixtures';

test.describe('US2 - Status Bar', () => {
    test('displays correct status information (location, hints, time)', async ({ page }) => {
        await signInAsTestProfile(page);
        await page.route('**/api/game-sessions-list*', async route => {
            await route.fulfill({ json: EMPTY_CATALOG });
        });
        await page.route('**/api/blueprints-list*', async route => {
            await route.fulfill({ json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1' })] } });
        });

        await page.route('**/api/game-start', async route => {
            await route.fulfill({
                json: createGameStartResponse({
                    state: createGameState({
                        locations: [{ id: 'loc-kitchen', name: 'kitchen' }, { id: 'loc-garden', name: 'garden' }],
                        characters: [
                            { id: 'char-bob', first_name: 'Bob', location_id: 'loc-kitchen', location_name: 'kitchen', sex: 'male' },
                            { id: 'char-alice', first_name: 'Alice', location_id: 'loc-garden', location_name: 'garden', sex: 'female' },
                        ],
                        time_remaining: 8,
                        location: 'loc-kitchen',
                    }),
                    narration_events: [
                        createNarrationEvent({
                            narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
                        }),
                    ],
                })
            });
        });

        await page.goto('/');
        await expect(page.getByText('1. Start a new game')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page.getByText('B1')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page).toHaveURL(/.*\/session/);

        // Verify header/status elements
        await expect(page.getByTestId('status-line')).toContainText(/^kitchen · /);
        await expect(page.locator('text=TIME: 8')).toBeVisible();
        // Labelled for what it counts, so it cannot be misread as a page or
        // turn number sitting next to TIME.
        await expect(page.locator('text=CLUES: 0')).toBeVisible();
        // Only characters in the current location should be shown.
        await expect(page.getByTestId('status-line')).toContainText(' · Bob · ');
        await expect(page.getByTestId('status-line')).not.toContainText('Alice');
    });

    test('shows accusations left in every mode, and one fewer after a failed accusation', async ({ page }) => {
        await signInAsTestProfile(page);
        await page.route('**/api/game-sessions-list*', async route => {
            await route.fulfill({ json: EMPTY_CATALOG });
        });
        await page.route('**/api/blueprints-list*', async route => {
            await route.fulfill({ json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1' })] } });
        });
        await page.route('**/api/game-start', async route => {
            await route.fulfill({
                json: createGameStartResponse({
                    narration_events: [
                        createNarrationEvent({
                            narration_parts: [{ text: 'A case.', speaker: narratorSpeaker }],
                        }),
                    ],
                }),
            });
        });
        await stubTurns(page, ({ input }) => {
            const where = { location: 'loc-kitchen', time_remaining: 9 };
            if (input === 'talk to Bob') {
                return playedTurn('talk', 'Bob nods.', { state: { ...where, mode: 'talk', current_talk_character: 'char-bob', accusations_left: 3 } });
            }
            if (input === 'bye') {
                return playedTurn('end_talk', 'Bye.', { state: { ...where, mode: 'explore', accusations_left: 3 } });
            }
            if (input === 'accuse') {
                return playedTurn('accuse_start', 'Who did it?', { state: { ...where, mode: 'accuse', accusations_left: 3 } });
            }
            return playedTurn('accuse_failed', 'Not quite.', { state: { ...where, mode: 'explore', accusations_left: 2 } });
        });

        await page.goto('/');
        await expect(page.getByText('1. Start a new game')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page.getByText('B1')).toBeVisible();
        await page.keyboard.press('1');
        await expect(page).toHaveURL(/.*\/session/);
        await confirmOpening(page);

        const input = page.locator('input[type="text"]');
        const say = async (line: string) => {
            await input.fill(line);
            await input.press('Enter');
        };

        // Exploring, then talking, then back to exploring: still three.
        await expect(page.locator('text=ACCUSATIONS: 3')).toBeVisible();
        await say('talk to Bob');
        await expect(page.getByText('Bob nods.')).toBeVisible();
        await expect(page.locator('text=ACCUSATIONS: 3')).toBeVisible();
        await say('bye');
        await expect(page.getByText('Bye.')).toBeVisible();

        // Accusing: still three until one is judged.
        await say('accuse');
        await expect(page.getByText('Who did it?')).toBeVisible();
        await expect(page.locator('text=ACCUSATIONS: 3')).toBeVisible();

        await say('Maybe Bob?');
        await expect(page.getByText('Not quite.')).toBeVisible();
        await expect(page.locator('text=ACCUSATIONS: 2')).toBeVisible();
        await expect(page.locator('text=TIME: 9')).toBeVisible();
    });
});
