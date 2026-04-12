import { gameSessionStore } from './store.svelte';

export type MobileHomeView = 'menu' | 'new-game';

export class MobileHomeState {
  view = $state<MobileHomeView>('menu');
  startingBlueprintId = $state<string | null>(null);

  get inProgressCount(): number {
    return gameSessionStore.sessionCatalog.counts.in_progress;
  }

  get completedCount(): number {
    return gameSessionStore.sessionCatalog.counts.completed;
  }

  get hasInProgress(): boolean {
    return this.inProgressCount > 0;
  }

  get hasCompleted(): boolean {
    return this.completedCount > 0;
  }

  get isLoadingBlueprints(): boolean {
    return gameSessionStore.status === 'loading' && gameSessionStore.blueprints.length === 0;
  }

  async enterNewGameFlow(): Promise<void> {
    this.view = 'new-game';
    if (gameSessionStore.blueprints.length === 0 && gameSessionStore.status === 'idle') {
      await gameSessionStore.loadBlueprints();
    }
  }

  backToMenu(): void {
    this.view = 'menu';
    gameSessionStore.error = null;
  }

  /**
   * Returns true if navigation to /session should happen.
   */
  async startBlueprint(blueprintId: string): Promise<boolean> {
    this.startingBlueprintId = blueprintId;
    await gameSessionStore.startGame(blueprintId);
    const success = gameSessionStore.status === 'active';
    this.startingBlueprintId = null;
    return success;
  }
}
