import { test, expect, type Page } from '@playwright/test';
import { BlueprintsListResponseSchema } from '@my2/shared';
import { signInAsTestProfile } from './test-profile';

import { MOCK_CASE_ID } from '../../tests/testkit/src/mock-case';

// Keep the full game usable on the software WebGL2 fallback used by CI.
test.use({ launchOptions: { args: ['--disable-webgpu', '--use-angle=swiftshader'] } });

async function startCase(page: Page, blueprintId: string, graphicsAvailable = true) {
  await signInAsTestProfile(page, 'graphical-case');
  const response = await page.request.get('/api/blueprints-list');
  const { blueprints } = BlueprintsListResponseSchema.parse(
    await response.json(),
  );
  const index = blueprints.findIndex(
    (blueprint) => blueprint.id === blueprintId,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: blueprints[index].title, exact: true })).toBeVisible();
  const cover = page.locator(`[data-testid="case-artwork"][data-blueprint-id="${blueprintId}"]`);
  await cover.scrollIntoViewIfNeeded();
  await expect(cover.getByTestId('scene-renderer')).toHaveAttribute('data-state', graphicsAvailable ? 'ready' : 'fallback', { timeout: 30000 });
  if (graphicsAvailable) {
    await expect(cover.getByTestId('scene-renderer')).toHaveAttribute('data-paused', 'true');
    await expect(cover.getByRole('img')).toBeInViewport();
    await test.info().attach('case-picker', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.keyboard.press(String(index + 1));
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
  await expect(page.getByTestId('scene-renderer')).toHaveAttribute('data-state', graphicsAvailable ? 'ready' : 'fallback', { timeout: 30000 });
  if (graphicsAvailable) {
    await expect(page.getByTestId('scene-renderer').getByRole('img')).toBeInViewport();
    await test.info().attach('opening-page', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await expect(page.getByTestId('page-narration')).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('input[type="text"]')).toBeEnabled();
}

async function submit(page: Page, line: string) {
  const input = page.locator('input[type="text"]');
  await input.fill(line);
  await input.press('Enter');
  await expect(input).toBeEnabled();
}

async function expectScene(page: Page, location: string) {
  const scene = page.getByTestId('scene-renderer');
  await expect(scene).toHaveAttribute('data-location-id', location);
  await expect(scene).toHaveAttribute('data-kind', 'procedural');
  await expect(scene).toHaveAttribute('data-state', 'ready', {
    timeout: 30000,
  });
  await expect(scene.getByRole('img')).toBeInViewport();
  await expect(page.getByTestId('page-narration')).toBeInViewport();
  await expect(page.locator('input[type="text"]')).toBeInViewport();
}

test('plays both mock case locations with real narration, dialogue, history, and resume', async ({
  page,
}) => {
  test.setTimeout(60000);
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  await startCase(page, MOCK_CASE_ID);
  await expectScene(page, 'loc-kitchen');
  expect(await page.locator('canvas').evaluate((canvas) => canvas.getContext('webgl2') !== null)).toBe(true);
  await expect(page.getByTestId('page-narration')).toContainText(
    'You arrive at Kitchen',
  );
  await submit(page, 'talk to Alice');
  // Alice has a portrait, which a conversation prefers to scenery.
  await expect(page.getByTestId('scene-renderer')).toHaveCount(0);
  await submit(page, 'What can you tell me?');
  const reply = page.locator('[data-speaker-kind="character"]').last();
  await expect(reply).toContainText('Alice');
  await expect(reply).toBeInViewport();
  await expect(page.locator('input[type="text"]')).toBeFocused();
  await submit(page, 'bye');
  await expectScene(page, 'loc-kitchen');
  await submit(page, 'go Living Room');
  await expectScene(page, 'loc-living-room');

  await page.reload();
  await expect(page.getByText('2. View in-progress games')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.getByText('Mock Case')).toBeVisible();
  await page.keyboard.press('1');
  await expectScene(page, 'loc-living-room');
  const input = page.locator('input[type="text"]');
  await input.fill('search the shelf');
  await page.keyboard.press('PageUp');
  await expectScene(page, 'loc-kitchen');
  await expect(input).toHaveValue('search the shelf');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectScene(page, 'loc-kitchen');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('dialog', { name: /case notebook/i }),
  ).toBeVisible();
  expect(uncaught).toEqual([]);
});

test('keeps actual narration, dialogue, and typing usable when graphics cannot initialize', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      return type === 'webgl2'
        ? null
        : getContext.apply(this, [type, ...args] as Parameters<
            typeof getContext
          >);
    } as typeof getContext;
  });
  const errors: string[] = [];
  const uncaught: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[scene]')) errors.push(message.text());
  });
  page.on('pageerror', (error) => uncaught.push(error.message));
  await startCase(page, MOCK_CASE_ID, false);
  const failuresOnStart = errors.length;
  expect(failuresOnStart).toBeGreaterThan(0);
  await expect(page.getByTestId('scene-renderer')).toHaveAttribute(
    'data-state',
    'fallback',
  );
  await expect(page.getByTestId('page-narration')).toContainText(
    'You arrive at Kitchen',
  );
  await submit(page, 'talk to Alice');
  await submit(page, 'What can you tell me?');
  await expect(
    page.locator('[data-speaker-kind="character"]').last(),
  ).toBeInViewport();
  await expect(page.locator('input[type="text"]')).toBeFocused();
  expect(errors).toHaveLength(failuresOnStart);
  expect(uncaught).toEqual([]);
});
