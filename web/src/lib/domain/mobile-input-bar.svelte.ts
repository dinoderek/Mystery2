export class MobileInputBarState {
  value = $state('');
  disabled = $state(false);

  /** Initialize with optional prefill text. */
  init(prefill?: string): void {
    if (prefill) {
      this.value = prefill;
    }
  }

  /** Returns true if the input has non-whitespace content and is not disabled. */
  get canSend(): boolean {
    return this.value.trim().length > 0 && !this.disabled;
  }

  /**
   * Attempts to send the current value.
   * Calls onsend with the trimmed value and clears the input.
   * Returns true if the send was executed, false if blocked.
   */
  send(onsend: (text: string) => void): boolean {
    if (!this.canSend) return false;
    const text = this.value.trim();
    onsend(text);
    this.value = '';
    return true;
  }

  /**
   * Handles keyboard events for the input.
   * Submits on Enter (without shift), prevents default.
   */
  handleKeydown(
    e: { key: string; shiftKey: boolean; preventDefault: () => void },
    onsend: (text: string) => void,
  ): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send(onsend);
    }
  }
}
