import { expect, test, type Page } from '@playwright/test';
import { signInAsTestProfile } from '../test-profile';
import { listOnlyMockCase, playedTurn, stubTurns } from '../session-helpers';
import { expectScreenFits, isInsideViewport } from '../layout-helpers';
import {
  createSessionCatalog,
  createSessionSummary,
  createTurnViewResponse,
} from '../../../tests/testkit/src/fixtures';

// Runs on the phone and tablet projects. Every in-scope screen is visited at
// the device's own size and its turn on its side, and on a phone at the
// smallest size the plan covers, 360 × 640, and on its side. Nothing presses a
// key. The on-screen keyboard cannot be shown in emulation: a smaller viewport
// height stands for it, and the page follows the resize through the visual
// viewport, as it does on a device. A real device is the operator's check.

interface Size {
  width: number;
  height: number;
}

function sizesFor(project: string, own: Size): Size[] {
  const turned = { width: own.height, height: own.width };
  return project === 'phone'
    ? [own, turned, { width: 360, height: 640 }, { width: 640, height: 360 }]
    : [own, turned];
}

const LONG_TITLE = 'The Mystery of the Very Long Locked Library and the Missing Golden Bookmark';

async function seedSessionLists(page: Page) {
  await page.route('**/api/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: createSessionCatalog({
        in_progress: [
          createSessionSummary({ game_id: '00000000-0000-0000-0000-000000000041', mystery_title: LONG_TITLE }),
          createSessionSummary({ game_id: '00000000-0000-0000-0000-000000000042', mystery_available: false }),
        ],
        completed: [
          createSessionSummary({
            game_id: '00000000-0000-0000-0000-000000000043',
            mystery_title: LONG_TITLE,
            mode: 'ended',
            time_remaining: 0,
            outcome: 'win',
          }),
        ],
        counts: { in_progress: 2, completed: 1 },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await listOnlyMockCase(page);
  await seedSessionLists(page);
  await signInAsTestProfile(page, 'touch-layout');
});

test('every screen fits the viewport, in portrait and landscape', async ({ page }, testInfo) => {
  const own = page.viewportSize();
  expect(own).not.toBeNull();

  const turns = await stubTurns(page, ({ input }) =>
    input === 'help'
      ? createTurnViewResponse({ view: 'help' })
      : playedTurn('search', 'You look around the kitchen.'),
  );

  for (const size of sizesFor(testInfo.project.name, own!)) {
    const at = `${size.width}×${size.height}`;
    await page.setViewportSize(size);

    await page.goto('/');
    await expect(page.getByTestId('menu-row-1')).toBeVisible();
    await expectScreenFits(page, `landing menu at ${at}`);

    await page.getByTestId('menu-row-1').tap();
    await expect(page.getByTestId('case-card-1')).toBeVisible();
    await expectScreenFits(page, `new-game list at ${at}`);

    await page.goto('/sessions/in-progress');
    await expect(page.getByTestId('session-row-1')).toBeVisible();
    await expectScreenFits(page, `in-progress list at ${at}`);

    await page.goto('/sessions/completed');
    await expect(page.getByTestId('session-row-1')).toBeVisible();
    await expectScreenFits(page, `completed list at ${at}`);

    await page.goto('/');
    await page.getByTestId('menu-row-1').tap();
    await page.getByTestId('case-card-1').tap();
    await expect(page).toHaveURL(/\/session$/);
    await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
    await expectScreenFits(page, `session opening at ${at}`);

    await page.getByTestId('begin-investigation-prompt').tap();
    const input = page.locator('input[type="text"]');
    await expect(input).toBeVisible();
    await expectScreenFits(page, `session at ${at}`);

    // The notebook, on each of its sections.
    await page.getByRole('button', { name: /CLUES:/ }).tap();
    const notebook = page.getByRole('dialog', { name: 'CASE NOTEBOOK' });
    await expect(notebook).toBeVisible();
    for (const tab of await notebook.getByRole('tab').all()) {
      await tab.tap();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expectScreenFits(page, `notebook at ${at}`);
    }
    const close = notebook.getByRole('button', { name: '[ CLOSE ]' });
    await expect(close).toBeInViewport();
    await close.tap();
    await expect(notebook).toBeHidden();

    // Help.
    await input.fill('help');
    await page.getByTestId('send-button').tap();
    const help = page.getByText('COMMAND REFERENCE');
    await expect(help).toBeVisible();
    await expectScreenFits(page, `help at ${at}`);
    await expect(page.getByRole('button', { name: '[ CLOSE ]' })).toBeInViewport();
    await page.getByRole('button', { name: '[ CLOSE ]' }).tap();
    await expect(help).toBeHidden();
  }

  expect(turns.length).toBeGreaterThan(0);
});

test('the input and the latest narration stay visible as the viewport shrinks', async ({ page }) => {
  const lines = Array.from({ length: 12 }, (_, i) => `Clue number ${i + 1} is somewhere in the kitchen cupboards.`);
  await stubTurns(page, () =>
    playedTurn('search', lines.join('\n'), { more: [{ text: 'LAST LINE OF THE STORY', speaker: { kind: 'narrator', key: 'narrator', label: 'Narrator' } }] }),
  );

  // The art pane going to nothing and coming back must not break the scene.
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  // A missing image is not the scene failing: the mock case ships no art files.
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) failures.push(message.text());
  });

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await page.getByTestId('menu-row-1').tap();
  await page.getByTestId('case-card-1').tap();
  await page.getByTestId('begin-investigation-prompt').tap();
  const input = page.locator('input[type="text"]');
  await input.fill('search');
  await page.getByTestId('send-button').tap();
  const latest = page.getByText('LAST LINE OF THE STORY');
  await expect(latest).toBeVisible();

  // The art is there on a tall screen, and gives way as the keyboard takes the height.
  const art = page.getByTestId('scene-pane');
  await expect.poll(async () => (await art.boundingBox())?.height ?? 0).toBeGreaterThan(100);

  for (const height of [640, 420, 300]) {
    // `setViewportSize` resizes the visual viewport, as the keyboard does on a device.
    await page.setViewportSize({ width: 360, height });
    await expect.poll(() => isInsideViewport(page, { locator: 'input[type="text"]' })).toBe(true);
    await expect.poll(() => isInsideViewport(page, 'send-button')).toBe(true);
    await expect.poll(async () => {
      const box = await latest.boundingBox();
      const narration = await page.getByTestId('page-narration').boundingBox();
      return box !== null && narration !== null && box.y >= narration.y && box.y + box.height <= narration.y + narration.height;
    }).toBe(true);
    await expect.poll(() => isInsideViewport(page, 'page-narration')).toBe(true);
  }

  // At the height the keyboard leaves, the art has given up its space.
  expect((await art.boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);

  // And it returns when the keyboard goes.
  await page.setViewportSize({ width: 360, height: 640 });
  await expect.poll(async () => (await art.boundingBox())?.height ?? 0).toBeGreaterThan(100);
  expect(failures).toEqual([]);
});
