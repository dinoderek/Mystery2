import { gameSessionStore } from './store.svelte';
import { themeStore, type Theme } from './theme-store.svelte';
import { mobilePrefs, type TextSize } from './mobile-prefs.svelte';

export class MobileDrawerState {
  get currentLocationName(): string {
    const state = gameSessionStore.state;
    if (!state) return 'UNKNOWN';
    const loc = state.locations.find((l) => l.id === state.location);
    return loc?.name || state.location;
  }

  get visibleCharacters(): { first_name: string; last_name: string }[] {
    const state = gameSessionStore.state;
    if (!state) return [];
    const currentLocation = state.location.trim().toLowerCase();
    return state.characters.filter(
      (c) => c.location_name.trim().toLowerCase() === currentLocation,
    );
  }

  get timeRemaining(): number {
    return gameSessionStore.state?.time_remaining ?? 0;
  }

  get hasActiveImage(): boolean {
    return gameSessionStore.activeStoryImage !== null;
  }

  get themes(): Theme[] {
    return themeStore.getThemeList();
  }

  get activeThemeId(): string {
    return themeStore.activeId;
  }

  get textSize(): TextSize {
    return mobilePrefs.textSize;
  }

  openHelp(): void {
    gameSessionStore.showHelp = true;
  }

  openZoom(): void {
    gameSessionStore.showZoomModal = true;
  }

  changeTheme(id: string): void {
    themeStore.setTheme(id);
    const activeThemeId = themeStore.getActiveTheme().id;
    gameSessionStore.setTheme(activeThemeId === 'amber' ? 'amber' : 'matrix', false);
  }

  changeTextSize(size: TextSize): void {
    mobilePrefs.setTextSize(size);
  }

  quit(): void {
    gameSessionStore.submitInput('quit');
  }
}
