import type { SessionPage } from './session-pages';

export const LIGHTHOUSE_BLUEPRINT_ID = '7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47';

// shortcut: one authored scene; replace this lookup when generated scene recipes arrive.
export function hasLighthouseScene(
  blueprintId: string | null,
  page: SessionPage | null,
): boolean {
  return (
    blueprintId === LIGHTHOUSE_BLUEPRINT_ID &&
    page?.kind === 'location' &&
    page.locationId === 'lantern_room'
  );
}
