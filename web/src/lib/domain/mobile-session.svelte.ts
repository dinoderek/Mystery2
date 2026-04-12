import { gameSessionStore } from './store.svelte';
import type { HistoryEntry } from '../types/game';

export type SessionMode = 'reading' | 'input';

export class MobileSessionState {
  sessionMode = $state<SessionMode>('reading');
  drawerOpen = $state(false);
  showImageViewer = $state(false);
  activeViewerImageId = $state<string | null>(null);
  inputDraft = $state('');
  inputPrefill = $state('');

  get isActive(): boolean {
    return gameSessionStore.status === 'active' && gameSessionStore.game_id !== null;
  }

  get title(): string {
    const blueprintId = gameSessionStore.blueprint_id;
    if (!blueprintId) return 'Mystery';
    const bp = gameSessionStore.blueprints.find((b) => b.id === blueprintId);
    return bp?.title ?? 'Mystery';
  }

  get turnsRemaining(): number {
    return gameSessionStore.state?.time_remaining ?? 0;
  }

  get isLoading(): boolean {
    return gameSessionStore.status === 'loading';
  }

  get isReadOnly(): boolean {
    return gameSessionStore.viewerMode === 'read_only_completed';
  }

  get isEndState(): boolean {
    return gameSessionStore.awaitingReturnToList || this.isReadOnly;
  }

  get accusationOutcome(): 'win' | 'lose' | null {
    return gameSessionStore.accusationOutcome;
  }

  get endStateLabel(): string {
    if (this.accusationOutcome === 'win') return 'CASE SOLVED';
    if (this.accusationOutcome === 'lose') return 'CASE UNSOLVED';
    return 'SESSION ENDED';
  }

  get inputPlaceholder(): string {
    const mode = gameSessionStore.state?.mode ?? 'explore';
    if (mode === 'talk') return 'Ask a question...';
    if (mode === 'accuse') return 'State your reasoning...';
    return 'Type a command...';
  }

  /** The prefill value to pass to MobileInputBar; consumed once. */
  get effectivePrefill(): string | undefined {
    if (this.inputPrefill) return this.inputPrefill;
    if (this.inputDraft) return this.inputDraft;
    return undefined;
  }

  /**
   * Returns the last interaction group from history —
   * entries matching the highest sequence number.
   */
  get lastInteractionGroup(): HistoryEntry[] {
    const history = gameSessionStore.state?.history;
    if (!history || history.length === 0) return [];
    const maxSeq = history.reduce(
      (max, entry) => (entry.sequence > max ? entry.sequence : max),
      0,
    );
    return history.filter((entry) => entry.sequence === maxSeq);
  }

  // --- Mode switching ---

  switchToInput(): void {
    this.inputPrefill = '';
    this.sessionMode = 'input';
  }

  switchToInputWithPrefill(text: string): void {
    this.inputPrefill = text;
    this.inputDraft = '';
    this.sessionMode = 'input';
  }

  switchToReading(): void {
    this.sessionMode = 'reading';
    this.inputPrefill = '';
  }

  // --- Input handling ---

  handleSend(text: string): void {
    gameSessionStore.submitInput(text);
    this.inputDraft = '';
    this.inputPrefill = '';
    this.switchToReading();
  }

  handleCancel(): void {
    this.inputDraft = '';
    this.inputPrefill = '';
    this.switchToReading();
  }

  // --- Drawer ---

  toggleDrawer(): void {
    this.drawerOpen = !this.drawerOpen;
  }

  // --- Image viewer ---

  openImageViewer(imageId: string): void {
    this.activeViewerImageId = imageId;
    this.showImageViewer = true;
  }

  closeImageViewer(): void {
    this.showImageViewer = false;
    this.activeViewerImageId = null;
  }

  // --- End state ---

  async handleEndStateTap(): Promise<void> {
    try {
      await gameSessionStore.loadSessionCatalog(true);
    } catch {
      // Ignore catalog load errors — we're leaving the session regardless.
    }
    gameSessionStore.clearSessionForMysteryList();
  }
}
