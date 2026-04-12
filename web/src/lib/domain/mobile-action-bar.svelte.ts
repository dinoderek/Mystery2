import { gameSessionStore } from './store.svelte';

export type PickerKind = 'locations' | 'characters' | null;

export interface PickerItem {
  id: string;
  label: string;
  subtitle?: string;
}

export class MobileActionBarState {
  activePicker = $state<PickerKind>(null);

  get mode(): string {
    return gameSessionStore.state?.mode ?? 'explore';
  }

  get isLoading(): boolean {
    return gameSessionStore.status === 'loading';
  }

  get locationItems(): PickerItem[] {
    const state = gameSessionStore.state;
    if (!state) return [];

    return state.locations.map((loc) => {
      const chars = state.characters.filter(
        (c) => c.location_name.trim().toLowerCase() === loc.id.trim().toLowerCase(),
      );
      const subtitle =
        chars.length > 0
          ? chars.map((c) => `${c.first_name} ${c.last_name}`).join(', ')
          : '(empty)';
      return { id: loc.id, label: loc.name, subtitle };
    });
  }

  get characterItems(): PickerItem[] {
    const state = gameSessionStore.state;
    if (!state) return [];

    const currentLocation = state.location.trim().toLowerCase();
    return state.characters
      .filter((c) => c.location_name.trim().toLowerCase() === currentLocation)
      .map((c) => ({
        id: c.id,
        label: `${c.first_name} ${c.last_name}`,
      }));
  }

  get talkDisabled(): boolean {
    return this.characterItems.length === 0;
  }

  openLocationPicker(): void {
    this.activePicker = 'locations';
  }

  openCharacterPicker(): void {
    this.activePicker = 'characters';
  }

  closePicker(): void {
    this.activePicker = null;
  }

  selectLocation(item: PickerItem): void {
    this.activePicker = null;
    gameSessionStore.submitInput(`go to ${item.label}`);
  }

  selectCharacter(item: PickerItem): void {
    this.activePicker = null;
    gameSessionStore.submitInput(`talk to ${item.label}`);
  }

  submitSearch(): void {
    gameSessionStore.submitInput('search');
  }

  submitEndConvo(): void {
    gameSessionStore.submitInput('bye');
  }
}
