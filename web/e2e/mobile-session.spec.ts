import { test, expect, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  characterSpeaker as createCharacterSpeaker,
  createGameState,
  createSessionSummary,
  createSessionCatalog,
  createBlueprintSummary,
  createImageLinkResponse,
  createNarrationEvent,
  createSearchResponse,
  createMoveResponse,
  createTalkStartResponse,
  createTalkEndResponse,
  createAccuseResponse,
} from '../../tests/testkit/src/fixtures';

/**
 * Mobile E2E coverage for the session screen (T13).
 *
 * Runs under the `mobile-safari` Playwright project (iPhone 13 / WebKit).
 * Covers journeys J4-J11: reading, input, quick actions, image viewer,
 * drawer (help, status, text size, theme), exit, and end state.
 */

const rosieCharacterSpeaker = createCharacterSpeaker('Rosie Jones');

// ---------------------------------------------------------------------------
// Shared IDs — match testkit defaults where possible
// ---------------------------------------------------------------------------

const GAME_ID = '00000000-0000-0000-0000-000000000001';
const BLUEPRINT_ID = '00000000-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Base game state
// ---------------------------------------------------------------------------

const baseGameState = createGameState({
  locations: [
    { id: 'Kitchen', name: 'Kitchen' },
    { id: 'Garden', name: 'Garden' },
    { id: 'Barn', name: 'Barn' },
  ],
  characters: [
    { id: 'char-rosie', first_name: 'Rosie', last_name: 'Jones', location_id: 'Kitchen', location_name: 'Kitchen', sex: 'female' },
    { id: 'char-bob', first_name: 'Bob', last_name: 'Smith', location_id: 'Garden', location_name: 'Garden', sex: 'male' },
  ],
  time_remaining: 8,
  location: 'Kitchen',
  mode: 'explore',
  current_talk_character: null,
  history: [] as Array<{
    sequence: number;
    event_type: string;
    text: string;
    speaker: { kind: string; key: string; label: string };
    image_id?: string | null;
  }>,
});

// ---------------------------------------------------------------------------
// Reusable factory instances
// ---------------------------------------------------------------------------

const inProgressSession = createSessionSummary({
  game_id: GAME_ID,
  blueprint_id: BLUEPRINT_ID,
  time_remaining: 8,
});

const blueprint = createBlueprintSummary({ id: BLUEPRINT_ID });

const defaultImageLink = createImageLinkResponse();

// ---------------------------------------------------------------------------
// Helpers — mock API routes
// ---------------------------------------------------------------------------

/** Set up mocks to land on an active mobile session. */
async function setupActiveSession(page: Page, overrides?: { state?: Partial<typeof baseGameState> }) {
  const state = { ...baseGameState, ...overrides?.state };

  // Session catalog so MobileHome doesn't flicker
  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: createSessionCatalog({
        in_progress: [inProgressSession],
        completed: [],
        counts: { in_progress: 1, completed: 0 },
      }),
    });
  });

  // Blueprints list (needed for title resolution)
  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: { blueprints: [blueprint] },
    });
  });

  // Game start response
  await page.route('**/functions/v1/game-start*', async (route) => {
    await route.fulfill({
      json: {
        game_id: GAME_ID,
        state,
        narration_events: [
          createNarrationEvent({
            sequence: 1,
            event_type: 'start',
            narration_parts: [{ text: 'Your investigation begins at the old farmhouse.', speaker: narratorSpeaker }],
          }),
        ],
      },
    });
  });

  // Signed image link (for cover images)
  await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
    await route.fulfill({ json: defaultImageLink });
  });
}

/** Navigate to mobile home, tap "Start New Case", tap the blueprint card to enter session. */
async function enterSession(page: Page) {
  await page.goto('/');
  await page.getByTestId('mobile-home-new-game').tap();
  await expect(page.getByText('The Stolen Cake')).toBeVisible();
  await page.getByText('The Stolen Cake').tap();
  await expect(page).toHaveURL(/\/session/, { timeout: 10000 });
  // Wait for narration to render
  await expect(page.getByText('Your investigation begins at the old farmhouse.')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Reading mode tests (J4)
// ---------------------------------------------------------------------------

test.describe('mobile session — reading mode', () => {
  test('narration box displays history entries on session load', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await expect(page.getByText('Your investigation begins at the old farmhouse.')).toBeVisible();
  });

  test('top bar shows mystery title and turns remaining', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await expect(page.getByTestId('mobile-topbar-title')).toHaveText('The Stolen Cake');
    await expect(page.getByTestId('mobile-topbar-turns')).toHaveText('[8]');
  });

  test('action bar shows explore mode buttons', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await expect(page.getByTestId('action-move')).toBeVisible();
    await expect(page.getByTestId('action-talk')).toBeVisible();
    await expect(page.getByTestId('action-search')).toBeVisible();
    await expect(page.getByTestId('action-accuse')).toBeVisible();
    await expect(page.getByTestId('action-reply')).toBeVisible();
  });

  test('floating reply button is visible', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await expect(page.getByTestId('mobile-session-reply-fab')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Input mode tests (J5)
// ---------------------------------------------------------------------------

test.describe('mobile session — input mode', () => {
  test('tap reply button opens input mode with input bar', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-session-reply-fab').tap();
    await expect(page.getByTestId('mobile-input-bar')).toBeVisible();
    await expect(page.getByTestId('mobile-input-bar-input')).toBeVisible();
  });

  test('type text and tap send submits input and returns to reading mode', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    await page.route('**/functions/v1/game-search*', async (route) => {
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: [{ text: 'You find a muddy footprint near the pantry.', speaker: narratorSpeaker }],
          time_remaining: 7,
          mode: 'explore',
        }),
      });
    });

    await enterSession(page);

    // Switch to input mode
    await page.getByTestId('mobile-session-reply-fab').tap();
    await expect(page.getByTestId('mobile-input-bar-input')).toBeVisible();

    // Type and send
    await page.getByTestId('mobile-input-bar-input').fill('search');
    await page.getByTestId('mobile-input-bar-send').tap();

    // Should return to reading mode and show new narration
    await expect(page.getByTestId('mobile-input-bar')).not.toBeVisible();
    await expect(page.getByText('You find a muddy footprint near the pantry.')).toBeVisible();
  });

  test('tap cancel returns to reading mode and clears input', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    // Switch to input mode
    await page.getByTestId('mobile-session-reply-fab').tap();
    await expect(page.getByTestId('mobile-input-bar-input')).toBeVisible();

    // Type something then cancel
    await page.getByTestId('mobile-input-bar-input').fill('search');
    await page.getByTestId('mobile-input-bar-cancel').tap();

    // Should return to reading mode
    await expect(page.getByTestId('mobile-input-bar')).not.toBeVisible();
    await expect(page.getByTestId('mobile-action-bar')).toBeVisible();
  });

  test('prefilled input from quick action shows pre-filled text', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    // Tap accuse — should prefill input with "accuse "
    await page.getByTestId('action-accuse').tap();
    await expect(page.getByTestId('mobile-input-bar-input')).toBeVisible();
    await expect(page.getByTestId('mobile-input-bar-input')).toHaveValue('accuse ');
  });
});

// ---------------------------------------------------------------------------
// Quick action tests (J6)
// ---------------------------------------------------------------------------

test.describe('mobile session — quick actions', () => {
  test('tap Search submits search command', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    await page.route('**/functions/v1/game-search*', async (route) => {
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: [{ text: 'You spot fresh crumbs on the counter.', speaker: narratorSpeaker }],
          time_remaining: 7,
          mode: 'explore',
        }),
      });
    });

    await enterSession(page);
    await page.getByTestId('action-search').tap();

    await expect(page.getByText('You spot fresh crumbs on the counter.')).toBeVisible();
  });

  test('tap Move opens location picker with locations listed', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('action-move').tap();

    // Location picker should appear
    await expect(page.getByTestId('mobile-list-picker-panel')).toBeVisible();
    await expect(page.getByText('Move to...')).toBeVisible();
    await expect(page.getByText('Kitchen')).toBeVisible();
    await expect(page.getByText('Garden')).toBeVisible();
    await expect(page.getByText('Barn')).toBeVisible();
  });

  test('location picker shows characters at each location', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('action-move').tap();
    await expect(page.getByTestId('mobile-list-picker-panel')).toBeVisible();

    // Kitchen has Rosie Jones
    await expect(page.getByText('Rosie Jones')).toBeVisible();
    // Garden has Bob Smith
    await expect(page.getByText('Bob Smith')).toBeVisible();
    // Barn is empty
    await expect(page.getByText('(empty)')).toBeVisible();
  });

  test('tap a location in picker submits move command', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    await page.route('**/functions/v1/game-move*', async (route) => {
      await route.fulfill({
        json: createMoveResponse({
          narration_parts: [{ text: 'You walk through the garden gate.', speaker: narratorSpeaker }],
          time_remaining: 7,
          mode: 'explore',
          current_location: 'Garden',
          visible_characters: [{ first_name: 'Bob', last_name: 'Smith', sex: 'male' }],
        }),
      });
    });

    await enterSession(page);
    await page.getByTestId('action-move').tap();
    await expect(page.getByTestId('mobile-list-picker-panel')).toBeVisible();

    // Tap Garden in the picker
    const gardenRow = page.getByTestId('mobile-list-picker-row').filter({ hasText: 'Garden' });
    await gardenRow.tap();

    // Picker should close and narration should appear
    await expect(page.getByTestId('mobile-list-picker-panel')).not.toBeVisible();
    await expect(page.getByText('You walk through the garden gate.')).toBeVisible();
  });

  test('tap Talk opens character picker with current location characters', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('action-talk').tap();

    // Character picker should show only Kitchen characters (Rosie)
    await expect(page.getByTestId('mobile-list-picker-panel')).toBeVisible();
    await expect(page.getByText('Talk to...')).toBeVisible();
    await expect(page.getByText('Rosie Jones')).toBeVisible();
    // Bob is in Garden, not Kitchen — should not appear
    await expect(page.getByTestId('mobile-list-picker-row')).toHaveCount(1);
  });

  test('tap a character submits talk command and switches to talk mode', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    await page.route('**/functions/v1/game-talk*', async (route) => {
      await route.fulfill({
        json: createTalkStartResponse({
          narration_parts: [{ text: 'Rosie looks up from the stove.', speaker: rosieCharacterSpeaker }],
          time_remaining: 7,
          mode: 'talk',
          current_talk_character: 'Rosie Jones',
        }),
      });
    });

    await enterSession(page);
    await page.getByTestId('action-talk').tap();
    await expect(page.getByTestId('mobile-list-picker-panel')).toBeVisible();

    // Tap Rosie
    await page.getByTestId('mobile-list-picker-row').filter({ hasText: 'Rosie Jones' }).tap();

    // Should see talk narration and talk-mode buttons
    await expect(page.getByText('Rosie looks up from the stove.')).toBeVisible();
    await expect(page.getByTestId('action-end-convo')).toBeVisible();
    await expect(page.getByTestId('action-reply')).toBeVisible();
    // Explore-only buttons should be gone
    await expect(page.getByTestId('action-move')).not.toBeVisible();
    await expect(page.getByTestId('action-search')).not.toBeVisible();
  });

  test('tap End convo in talk mode submits bye command', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page, {
      state: {
        mode: 'talk',
        current_talk_character: 'Rosie Jones',
        history: [
          { sequence: 1, event_type: 'talk', text: 'Rosie waves hello.', speaker: rosieCharacterSpeaker },
        ],
      },
    });

    await page.route('**/functions/v1/game-end-talk*', async (route) => {
      await route.fulfill({
        json: createTalkEndResponse({
          narration_parts: [{ text: 'You end the conversation.', speaker: narratorSpeaker }],
          time_remaining: 7,
          mode: 'explore',
          current_talk_character: null,
        }),
      });
    });

    await enterSession(page);

    // Should be in talk mode
    await expect(page.getByTestId('action-end-convo')).toBeVisible();

    await page.getByTestId('action-end-convo').tap();
    await expect(page.getByText('You end the conversation.')).toBeVisible();

    // Should be back in explore mode
    await expect(page.getByTestId('action-move')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Drawer tests (J8, J9, J11)
// ---------------------------------------------------------------------------

test.describe('mobile session — drawer', () => {
  test('tap hamburger opens drawer with status info', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-menu').tap();
    await expect(page.getByTestId('mobile-drawer-panel')).toBeVisible();
  });

  test('drawer status shows correct location, time, and characters', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-menu').tap();

    await expect(page.getByTestId('mobile-drawer-location')).toHaveText('Kitchen');
    await expect(page.getByTestId('mobile-drawer-time')).toHaveText('8');
    await expect(page.getByTestId('mobile-drawer-characters')).toContainText('Rosie Jones');
  });

  test('tap Help opens HelpModal', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-menu').tap();
    await page.getByTestId('mobile-drawer-help').tap();

    // Drawer should close and help modal should be visible
    await expect(page.getByTestId('mobile-drawer-panel')).not.toBeVisible();
    await expect(page.getByText('EXPLORE MODE')).toBeVisible();
  });

  test('text size change applies to narration', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    // Open drawer and change text size to Large
    await page.getByTestId('mobile-topbar-menu').tap();
    await page.getByTestId('mobile-drawer-textsize-lg').tap();

    // Close drawer
    await page.getByTestId('mobile-drawer-close').tap();
    await expect(page.getByTestId('mobile-drawer-panel')).not.toBeVisible();

    // The reading mode wrapper (direct child of main) should have text-lg class
    const narrationWrapper = page.locator('[data-testid="mobile-session"] > .min-h-0');
    await expect(narrationWrapper).toHaveClass(/text-lg/);
  });

  test('theme picker applies theme change', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-menu').tap();

    // Find and tap a non-default theme — check that the theme buttons exist
    const themeButtons = page.locator('[data-testid^="mobile-drawer-theme-"]');
    const count = await themeButtons.count();
    expect(count).toBeGreaterThan(1);

    // Tap the second theme (whichever it is)
    await themeButtons.nth(1).tap();

    // The radio indicator should update — the second theme should now be selected
    const secondThemeIndicator = themeButtons.nth(1).locator('.bg-t-primary');
    await expect(secondThemeIndicator).toBeVisible();
  });

  test('drawer closes on backdrop tap', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-menu').tap();
    await expect(page.getByTestId('mobile-drawer-panel')).toBeVisible();

    // The panel (z-50) overlays the backdrop (z-40), so we dispatch click
    // directly on the backdrop element to simulate tapping the exposed area.
    await page.getByTestId('mobile-drawer-backdrop').dispatchEvent('click');
    await expect(page.getByTestId('mobile-drawer-panel')).not.toBeVisible();
  });

  test('drawer closes on close button tap', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-menu').tap();
    await expect(page.getByTestId('mobile-drawer-panel')).toBeVisible();

    await page.getByTestId('mobile-drawer-close').tap();
    await expect(page.getByTestId('mobile-drawer-panel')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Image viewer tests (J7)
// ---------------------------------------------------------------------------

test.describe('mobile session — image viewer', () => {
  test('tap image in narration opens fullscreen viewer', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    // Override game-start to include an image in narration
    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: {
          game_id: GAME_ID,
          state: baseGameState,
          narration_events: [
            createNarrationEvent({
              sequence: 1,
              event_type: 'start',
              narration_parts: [
                {
                  text: 'Your investigation begins at the old farmhouse.',
                  speaker: narratorSpeaker,
                  image_id: 'scene-kitchen.png',
                },
              ],
            }),
          ],
        },
      });
    });

    // The image link mock must return the same image_id as the narration event
    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      await route.fulfill({
        json: createImageLinkResponse({ image_id: 'scene-kitchen.png' }),
      });
    });

    await enterSession(page);

    // There should be an image in the narration — tap it
    const storyImagePanel = page.locator('.story-image-panel');
    await expect(storyImagePanel).toBeVisible({ timeout: 10000 });
    await storyImagePanel.tap();

    // Image viewer should appear
    const closeBtn = page.getByLabel('Close image viewer');
    await expect(closeBtn).toBeVisible();
  });

  test('tap close button dismisses image viewer', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: {
          game_id: GAME_ID,
          state: baseGameState,
          narration_events: [
            createNarrationEvent({
              sequence: 1,
              event_type: 'start',
              narration_parts: [
                {
                  text: 'Your investigation begins at the old farmhouse.',
                  speaker: narratorSpeaker,
                  image_id: 'scene-kitchen.png',
                },
              ],
            }),
          ],
        },
      });
    });

    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      await route.fulfill({
        json: createImageLinkResponse({ image_id: 'scene-kitchen.png' }),
      });
    });

    await enterSession(page);

    const storyImagePanel = page.locator('.story-image-panel');
    await expect(storyImagePanel).toBeVisible({ timeout: 10000 });
    await storyImagePanel.tap();

    const closeBtn = page.getByLabel('Close image viewer');
    await expect(closeBtn).toBeVisible();
    await closeBtn.tap();

    // Viewer should close
    await expect(closeBtn).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Exit tests (J10)
// ---------------------------------------------------------------------------

test.describe('mobile session — exit', () => {
  test('tap back arrow navigates to home', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-back').tap();
    await expect(page).toHaveURL(/\/$/);
  });

  test('tap End Session in drawer triggers quit flow', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);
    await enterSession(page);

    await page.getByTestId('mobile-topbar-menu').tap();
    await page.getByTestId('mobile-drawer-end-session').tap();

    // Drawer should close and end state should show
    await expect(page.getByTestId('mobile-drawer-panel')).not.toBeVisible();
    await expect(page.getByTestId('mobile-session-end-state')).toBeVisible();
    await expect(page.getByTestId('end-state-label')).toHaveText('SESSION ENDED');
  });
});

// ---------------------------------------------------------------------------
// End state tests
// ---------------------------------------------------------------------------

test.describe('mobile session — end state', () => {
  test('case solved shows correct outcome and tap returns to home', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    await page.route('**/functions/v1/game-accuse*', async (route) => {
      await route.fulfill({
        json: createAccuseResponse({
          narration_parts: [{ text: 'Excellent reasoning, detective.', speaker: narratorSpeaker }],
          mode: 'ended',
          result: 'win',
          time_remaining: 0,
        }),
      });
    });

    await enterSession(page);

    // Switch to input mode and accuse
    await page.getByTestId('action-accuse').tap();
    await expect(page.getByTestId('mobile-input-bar-input')).toBeVisible();
    await page.getByTestId('mobile-input-bar-input').fill('accuse Rosie did it because she had flour on her hands');
    await page.getByTestId('mobile-input-bar-send').tap();

    // End state should render
    await expect(page.getByTestId('mobile-session-end-state')).toBeVisible();
    await expect(page.getByTestId('end-state-label')).toHaveText('CASE SOLVED');
    await expect(page.getByText('Congratulations, detective.')).toBeVisible();

    // Tap to return home
    await page.getByTestId('mobile-session-end-state').tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
  });

  test('case unsolved shows correct outcome', async ({ page }) => {
    await enableAuthBypass(page);
    await setupActiveSession(page);

    await page.route('**/functions/v1/game-accuse*', async (route) => {
      await route.fulfill({
        json: createAccuseResponse({
          narration_parts: [{ text: 'The evidence does not support your accusation.', speaker: narratorSpeaker }],
          mode: 'ended',
          result: 'lose',
          time_remaining: 0,
        }),
      });
    });

    await enterSession(page);

    await page.getByTestId('action-accuse').tap();
    await page.getByTestId('mobile-input-bar-input').fill('accuse Bob because he looks suspicious');
    await page.getByTestId('mobile-input-bar-send').tap();

    await expect(page.getByTestId('mobile-session-end-state')).toBeVisible();
    await expect(page.getByTestId('end-state-label')).toHaveText('CASE UNSOLVED');
    await expect(page.getByText('The truth remains hidden.')).toBeVisible();
  });

  test('read-only completed session hides action bar and reply button', async ({ page }) => {
    await enableAuthBypass(page);

    const completedSession = createSessionSummary({
      game_id: '00000000-0000-0000-0000-000000000099',
      blueprint_id: BLUEPRINT_ID,
      mode: 'ended',
      time_remaining: 0,
      outcome: 'win',
      last_played_at: '2026-03-11T12:00:00.000Z',
      created_at: '2026-03-08T12:00:00.000Z',
    });

    // Mock catalog with completed session
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: createSessionCatalog({
          in_progress: [],
          completed: [completedSession],
          counts: { in_progress: 0, completed: 1 },
        }),
      });
    });

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: { blueprints: [blueprint] },
      });
    });

    await page.route('**/functions/v1/game-get*', async (route) => {
      await route.fulfill({
        json: {
          blueprint_id: BLUEPRINT_ID,
          state: {
            ...baseGameState,
            mode: 'ended',
            time_remaining: 0,
          },
          narration_events: [
            createNarrationEvent({
              sequence: 1,
              event_type: 'start',
              narration_parts: [{ text: 'Your investigation begins.', speaker: narratorSpeaker }],
            }),
            createNarrationEvent({
              sequence: 2,
              event_type: 'accuse_judge',
              narration_parts: [{ text: 'Case solved.', speaker: narratorSpeaker }],
            }),
          ],
        },
      });
    });

    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      await route.fulfill({ json: defaultImageLink });
    });

    await enableAuthBypass(page);

    // Navigate via completed list
    await page.goto('/sessions/completed');
    await expect(page.getByText('The Stolen Cake')).toBeVisible();
    await page.getByText('The Stolen Cake').tap();
    await expect(page).toHaveURL(/\/session/, { timeout: 10000 });

    // Should be in end state / read-only mode — action bar and reply button should be hidden
    await expect(page.getByTestId('mobile-session-end-state')).toBeVisible();
    await expect(page.getByTestId('mobile-action-bar')).not.toBeVisible();
    await expect(page.getByTestId('mobile-session-reply-fab')).not.toBeVisible();
  });
});
