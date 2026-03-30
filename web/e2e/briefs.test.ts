import { test, expect, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

const BRIEF_1 = {
  id: 'brief-aaa',
  brief: 'A stolen painting in a Victorian mansion with hidden passages',
  title_hint: 'The Vanishing Vermeer',
  target_age: 10,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-15T00:00:00Z',
  archived_at: null,
};

const BRIEF_2 = {
  id: 'brief-bbb',
  brief: 'A haunted lighthouse where ships keep disappearing',
  title_hint: 'The Lighthouse Keeper',
  target_age: 8,
  created_at: '2026-03-02T00:00:00Z',
  updated_at: '2026-03-12T00:00:00Z',
  archived_at: null,
};

const BRIEF_3 = {
  id: 'brief-ccc',
  brief: 'A mystery at the school science fair',
  title_hint: null,
  target_age: 7,
  created_at: '2026-03-05T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
  archived_at: null,
};

const BRIEF_FULL = {
  ...BRIEF_1,
  time_budget: 15,
  one_liner_hint: 'Find the missing masterpiece',
  art_style: 'watercolor noir',
  must_include: ['hidden passage', 'old diary'],
  culprits: 1,
  suspects: 3,
  witnesses: 2,
  locations: 4,
  red_herring_trails: 1,
  cover_ups: true,
  elimination_complexity: 'moderate',
};

/* ------------------------------------------------------------------ */
/*  Route helpers                                                     */
/* ------------------------------------------------------------------ */

async function mockSessionCatalog(page: Page) {
  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: {
        in_progress: [],
        completed: [],
        counts: { in_progress: 0, completed: 0 },
      },
    });
  });
}

async function mockBriefsList(page: Page, briefs = [BRIEF_1, BRIEF_2]) {
  await page.route('**/functions/v1/briefs-list*', async (route) => {
    await route.fulfill({ json: { briefs } });
  });
}

async function mockBriefsGet(page: Page, brief = BRIEF_FULL) {
  await page.route('**/functions/v1/briefs-get*', async (route) => {
    await route.fulfill({ json: { brief } });
  });
}

function mockBriefsSave(
  page: Page,
  onSave?: (payload: Record<string, unknown>) => void,
) {
  return page.route('**/functions/v1/briefs-save*', async (route) => {
    const body = route.request().postDataJSON();
    onSave?.(body);
    const saved = {
      ...BRIEF_FULL,
      ...body,
      id: body.id || 'new-brief-id',
      updated_at: new Date().toISOString(),
    };
    await route.fulfill({
      status: body.id ? 200 : 201,
      json: { brief: saved },
    });
  });
}

function mockBriefsArchive(
  page: Page,
  onArchive?: (briefId: string) => void,
) {
  return page.route('**/functions/v1/briefs-archive*', async (route) => {
    const body = route.request().postDataJSON();
    onArchive?.(body.brief_id);
    await route.fulfill({
      json: { brief: { id: body.brief_id, archived_at: new Date().toISOString() } },
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

test.describe('Brief Management', () => {

  // Journey 12: Main menu integration
  test('main menu shows "Manage briefs" and navigates to /briefs', async ({ page }) => {
    await enableAuthBypass(page);
    await mockSessionCatalog(page);
    await mockBriefsList(page);

    await page.goto('/');
    await expect(page.getByText('4. Manage briefs')).toBeVisible();

    await page.keyboard.press('4');
    await expect(page).toHaveURL(/\/briefs$/);
  });

  // Journey 11: Empty state
  test('shows empty state when no briefs exist', async ({ page }) => {
    await enableAuthBypass(page);
    await mockBriefsList(page, []);

    await page.goto('/briefs');

    await expect(page.getByTestId('briefs-empty')).toBeVisible();
    await expect(page.getByTestId('briefs-empty')).toContainText('No briefs yet');
  });

  // Journey 1: List → Edit → Save → List updated
  test('lists briefs, edits one, saves, and reflects changes', async ({ page }) => {
    await enableAuthBypass(page);

    let savedPayload: Record<string, unknown> | null = null;

    // Set up all mocks upfront with dynamic responses
    await page.route('**/functions/v1/briefs-list*', async (route) => {
      // After save, return updated list
      const briefs = savedPayload
        ? [{ ...BRIEF_1, title_hint: 'The Missing Masterpiece' }, BRIEF_2]
        : [BRIEF_1, BRIEF_2];
      await route.fulfill({ json: { briefs } });
    });
    await mockBriefsGet(page, BRIEF_FULL);
    await mockBriefsSave(page, (p) => { savedPayload = p; });

    await page.goto('/briefs');

    // Verify list
    const rows = page.getByTestId('brief-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('The Vanishing Vermeer');
    await expect(rows.nth(1)).toContainText('The Lighthouse Keeper');

    // Navigate to edit via Enter (first row is already focused)
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/briefs\/brief-aaa$/);

    // Verify form populated
    const briefField = page.getByTestId('brief-field');
    await expect(briefField).toHaveValue('A stolen painting in a Victorian mansion with hidden passages');
    await expect(page.getByTestId('target-age-field')).toHaveValue('10');
    await expect(page.getByTestId('title-hint-field')).toHaveValue('The Vanishing Vermeer');

    // Change title
    const titleInput = page.getByTestId('title-hint-field');
    await titleInput.clear();
    await titleInput.fill('The Missing Masterpiece');

    // Save with Ctrl+S
    await page.keyboard.press('Control+s');

    // Wait for navigation back to list
    await expect(page).toHaveURL(/\/briefs$/);
    expect(savedPayload).toBeTruthy();
    expect(savedPayload!.title_hint).toBe('The Missing Masterpiece');
    expect(savedPayload!.id).toBe('brief-aaa');
  });

  // Journey 2: Create new brief
  test('creates a new brief with required and optional fields', async ({ page }) => {
    await enableAuthBypass(page);

    let savedPayload: Record<string, unknown> | null = null;

    // Register all mocks upfront before any navigation
    await page.route('**/functions/v1/briefs-list*', async (route) => {
      const briefs = savedPayload
        ? [{ ...BRIEF_1, title_hint: 'The Clocktower Secret' }]
        : [];
      await route.fulfill({ json: { briefs } });
    });
    await mockBriefsSave(page, (p) => { savedPayload = p; });

    await page.goto('/briefs');
    await expect(page.getByTestId('briefs-empty')).toBeVisible();

    // Press 'n' to create
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/briefs\/new$/);

    // Fill required fields
    await page.getByTestId('brief-field').fill('A mystery at the old clocktower');
    await page.getByTestId('target-age-field').fill('10');

    // Fill optional fields
    await page.getByTestId('title-hint-field').fill('The Clocktower Secret');
    await page.getByTestId('art-style-field').fill('pixel art detective');

    // Add a must-include tag
    const tagInput = page.getByTestId('must-include-field');
    await tagInput.fill('hidden diary');
    await tagInput.press('Enter');
    await expect(page.getByText('hidden diary')).toBeVisible();

    await page.keyboard.press('Control+s');

    await expect(page).toHaveURL(/\/briefs$/);
    expect(savedPayload).toBeTruthy();
    expect(savedPayload!.brief).toBe('A mystery at the old clocktower');
    expect(savedPayload!.target_age).toBe(10);
    expect(savedPayload!.title_hint).toBe('The Clocktower Secret');
    expect(savedPayload!.art_style).toBe('pixel art detective');
    expect(savedPayload!.must_include).toEqual(['hidden diary']);
    // New brief should NOT have an id
    expect(savedPayload!.id).toBeFalsy();
  });

  // Journey 3: Archive brief
  test('archives a brief with confirmation', async ({ page }) => {
    await enableAuthBypass(page);
    await mockBriefsList(page, [BRIEF_1, BRIEF_2, BRIEF_3]);

    let archivedId: string | null = null;
    await mockBriefsArchive(page, (id) => { archivedId = id; });

    await page.goto('/briefs');
    await expect(page.getByTestId('brief-row')).toHaveCount(3);

    // Focus row 2 and archive
    await page.keyboard.press('2');  // Jump to row 2
    await page.keyboard.press('x');  // Request archive

    // Confirmation prompt
    await expect(page.getByTestId('archive-confirm')).toBeVisible();

    // Confirm
    await page.keyboard.press('y');

    // Wait for async archive to complete (confirm dialog disappears)
    await expect(page.getByTestId('archive-confirm')).not.toBeVisible();

    // Verify archived
    expect(archivedId).toBe('brief-bbb');
  });

  // Journey 4: Validation failure on create
  test('shows validation errors when required fields are missing', async ({ page }) => {
    await enableAuthBypass(page);

    await page.goto('/briefs/new');

    // Try to save with empty brief
    await page.getByTestId('target-age-field').fill('10');
    await page.keyboard.press('Control+s');

    await expect(page.getByTestId('error-brief')).toBeVisible();
    await expect(page.getByTestId('error-brief')).toContainText('required');

    // Fill brief, clear target age
    await page.getByTestId('brief-field').fill('A mystery');
    await page.getByTestId('target-age-field').clear();
    await page.keyboard.press('Control+s');

    await expect(page.getByTestId('error-targetAge')).toBeVisible();
  });

  // Journey 5: Validation failure on edit
  test('shows validation error when clearing required field on edit', async ({ page }) => {
    await enableAuthBypass(page);
    await mockBriefsGet(page, BRIEF_FULL);

    await page.goto('/briefs/brief-aaa');

    // Wait for form to load
    await expect(page.getByTestId('brief-field')).toHaveValue(BRIEF_FULL.brief);

    // Clear the brief field
    await page.getByTestId('brief-field').clear();
    await page.keyboard.press('Control+s');

    await expect(page.getByTestId('error-brief')).toBeVisible();
    // Should stay on edit page
    await expect(page).toHaveURL(/\/briefs\/brief-aaa$/);
  });

  // Journey 6: Keyboard navigation on list
  test('keyboard navigation works on brief list', async ({ page }) => {
    await enableAuthBypass(page);
    await mockBriefsList(page, [BRIEF_1, BRIEF_2, BRIEF_3]);
    await mockBriefsGet(page, BRIEF_FULL);

    await page.goto('/briefs');

    const rows = page.getByTestId('brief-row');

    // First row has focus ring by default
    await expect(rows.first()).toHaveClass(/ring-1/);

    // j moves down
    await page.keyboard.press('j');
    await expect(rows.nth(1)).toHaveClass(/ring-1/);

    // k moves up
    await page.keyboard.press('k');
    await expect(rows.first()).toHaveClass(/ring-1/);

    // Number key jumps
    await page.keyboard.press('3');
    await expect(rows.nth(2)).toHaveClass(/ring-1/);

    // Enter navigates to edit
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/briefs\/brief-ccc$/);
  });

  // Journey 7: Keyboard navigation on form
  test('tab navigation and tag input work on form', async ({ page }) => {
    await enableAuthBypass(page);

    await page.goto('/briefs/new');

    // Fill brief and tab to next field
    const briefField = page.getByTestId('brief-field');
    await briefField.fill('A mystery');

    // Tab to target age
    await page.keyboard.press('Tab');
    const targetAge = page.getByTestId('target-age-field');
    await expect(targetAge).toBeFocused();

    // Fill target age
    await targetAge.fill('10');

    // Test tag input
    const tagInput = page.getByTestId('must-include-field');
    await tagInput.focus();
    await tagInput.fill('hidden diary');
    await tagInput.press('Enter');
    await expect(page.getByText('hidden diary')).toBeVisible();

    // Add another tag
    await tagInput.fill('secret passage');
    await tagInput.press('Enter');
    await expect(page.getByText('secret passage')).toBeVisible();

    // Backspace on empty removes last tag
    await tagInput.press('Backspace');
    await expect(page.getByText('secret passage')).not.toBeVisible();
    await expect(page.getByText('hidden diary')).toBeVisible();
  });

  // Journey 8: Dirty form guard
  test('shows unsaved changes warning when leaving dirty form', async ({ page }) => {
    await enableAuthBypass(page);
    await mockBriefsGet(page, BRIEF_FULL);
    await mockBriefsList(page);

    await page.goto('/briefs/brief-aaa');
    await expect(page.getByTestId('brief-field')).toHaveValue(BRIEF_FULL.brief);

    // Make a change
    await page.getByTestId('title-hint-field').fill('Changed Title');

    // Try to leave
    await page.keyboard.press('Escape');

    // Confirmation should appear
    await expect(page.getByTestId('exit-confirm')).toBeVisible();

    // Cancel
    await page.keyboard.press('n');
    await expect(page.getByTestId('exit-confirm')).not.toBeVisible();
    await expect(page).toHaveURL(/\/briefs\/brief-aaa$/);

    // Try again and confirm
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('exit-confirm')).toBeVisible();
    await page.keyboard.press('y');
    await expect(page).toHaveURL(/\/briefs$/);
  });

  // Journey 10: Duplicate brief
  test('duplicates a brief with pre-populated form', async ({ page }) => {
    await enableAuthBypass(page);

    let savedPayload: Record<string, unknown> | null = null;

    // Register all mocks upfront before any navigation
    await mockBriefsGet(page, BRIEF_FULL);
    await page.route('**/functions/v1/briefs-list*', async (route) => {
      const briefs = savedPayload ? [BRIEF_1, BRIEF_2] : [BRIEF_1];
      await route.fulfill({ json: { briefs } });
    });
    await mockBriefsSave(page, (p) => { savedPayload = p; });

    await page.goto('/briefs');
    await expect(page.getByTestId('brief-row')).toHaveCount(1);

    // Press 'd' to duplicate — triggers async load then navigate
    await page.keyboard.press('d');
    await expect(page).toHaveURL(/\/briefs\/new$/);

    // Form should show "Copy of" in title
    await expect(page.getByTestId('title-hint-field')).toHaveValue('Copy of The Vanishing Vermeer');

    // Brief text should be pre-populated
    await expect(page.getByTestId('brief-field')).toHaveValue(BRIEF_FULL.brief);

    // Save
    await page.keyboard.press('Control+s');

    await expect(page).toHaveURL(/\/briefs$/);
    expect(savedPayload).toBeTruthy();
    expect(savedPayload!.id).toBeFalsy();
  });

  // Journey: Escape from list goes back to main menu
  test('pressing b or Escape from list goes to main menu', async ({ page }) => {
    await enableAuthBypass(page);
    await mockBriefsList(page, []);
    await mockSessionCatalog(page);

    await page.goto('/briefs');
    // Wait for page to hydrate and render the empty state
    await expect(page.getByTestId('briefs-empty')).toBeVisible();
    await page.keyboard.press('b');
    await expect(page).toHaveURL(/\/$/);
  });
});
