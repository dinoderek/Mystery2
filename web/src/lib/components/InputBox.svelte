<script lang="ts">
  import { goto } from "$app/navigation";
  import { gameSessionStore } from "$lib/domain/store.svelte";
  import { isCoarsePointer, shouldFocusInput } from "$lib/domain/input-focus";
  import { beginInvestigation, returnToMysteryList } from "$lib/domain/session-prompts";

  let inputValue = $state("");
  let inputElement = $state<HTMLInputElement | null>(null);
  let hasFocusedInput = $state(false);
  // Set by a sent line; the input is disabled while the turn runs, so the focus
  // is given back once it is enabled again.
  let focusWhenReady = $state(false);

  let placeholder = $derived(
    gameSessionStore.state?.mode === "talk"
      ? "> Talk mode..."
      : gameSessionStore.state?.mode === "accuse"
        ? "> Accuse mode..."
        : gameSessionStore.state?.mode === "ended"
          ? "> Case is over..."
          : "> Explore mode...",
  );

  let showReadOnlyPrompt = $derived(
    gameSessionStore.awaitingReturnToList || gameSessionStore.viewerMode === "read_only_completed",
  );

  // The opening page holds until the player is ready to step into the case.
  let showBeginPrompt = $derived(
    !showReadOnlyPrompt && gameSessionStore.awaitingOpeningConfirmation,
  );

  let disabled = $derived(
    gameSessionStore.status === "loading" ||
      gameSessionStore.state?.mode === "ended" ||
      showReadOnlyPrompt ||
      showBeginPrompt,
  );

  $effect(() => {
    if (!inputElement || disabled) {
      hasFocusedInput = false;
      return;
    }

    // Blur under the notebook so no caret blinks behind it and Enter cannot
    // submit a half-typed command through the overlay. Releasing the latch is
    // what makes the branch below refocus the input when the notebook closes.
    if (gameSessionStore.showNotebook) {
      inputElement.blur();
      hasFocusedInput = false;
      return;
    }

    if (hasFocusedInput) {
      return;
    }

    const trigger = focusWhenReady ? "sent" : "ready";
    if (!shouldFocusInput(isCoarsePointer(window.matchMedia.bind(window)), trigger)) {
      return;
    }

    inputElement.focus();
    hasFocusedInput = true;
    focusWhenReady = false;
  });

  // The one path a line takes: Enter, the keyboard's action key, dictation and
  // [ SEND ] all arrive as the form's submit event.
  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const text = inputValue;
    if (!text.trim() || disabled) {
      return;
    }

    inputValue = "";
    focusWhenReady = true;
    // Inside the gesture, so a tap on [ SEND ] does not drop the keyboard.
    inputElement?.focus();
    await gameSessionStore.submitInput(text);
  }

</script>

<div class="mt-4 border-t border-t-muted/30 pt-4">
  {#if showReadOnlyPrompt}
    <div class="space-y-2 text-sm" data-testid="accusation-end-state">
      {#if gameSessionStore.accusationOutcome === "win"}
        <p class="text-t-bright font-bold">[ CASE SOLVED ]</p>
        <p>The accusation is correct. Justice is served.</p>
      {:else if gameSessionStore.accusationOutcome === "lose"}
        <p class="text-t-error font-bold">[ CASE UNSOLVED ]</p>
        <p>The accusation is incorrect. The mystery remains unresolved.</p>
      {/if}
      <div class="flex flex-wrap items-center gap-2" data-testid="return-to-list-prompt">
        <button
          type="button"
          data-testid="review-notebook-button"
          class="min-h-11 border border-t-muted/40 px-3 text-t-bright hover:border-t-primary hover:text-t-primary"
          onclick={() => gameSessionStore.openNotebook()}
        >
          [ NOTEBOOK ]
        </button>
        <button
          type="button"
          data-testid="return-to-list-button"
          class="min-h-11 border border-t-muted/40 px-3 text-t-bright hover:border-t-primary hover:text-t-primary"
          onclick={() => returnToMysteryList(gameSessionStore, goto)}
        >
          [ MYSTERY LIST ]
        </button>
      </div>
      <p class="text-xs text-t-muted/60">
        Tap a button, or press Tab for the notebook or any other key for the mystery list.
      </p>
    </div>
  {:else if showBeginPrompt}
    <button
      type="button"
      data-testid="begin-investigation-prompt"
      class="min-h-11 w-full animate-pulse border border-t-muted/40 px-3 text-sm text-t-bright hover:border-t-primary hover:text-t-primary"
      onclick={() => beginInvestigation(gameSessionStore)}
    >
      [ TAP OR PRESS ANY KEY TO BEGIN THE INVESTIGATION ]
    </button>
  {:else}
    {#if gameSessionStore.isRetrying}
      <div class="mb-2 text-xs text-t-warning" data-testid="retry-indicator">
        Retrying request ({gameSessionStore.retryCount}/3)...
      </div>
    {/if}

    <form class="flex items-center gap-2" onsubmit={submit}>
      <!-- text-base is 16px: below it iOS zooms the page on focus. -->
      <input
        type="text"
        bind:this={inputElement}
        bind:value={inputValue}
        {placeholder}
        {disabled}
        class="min-h-11 min-w-0 flex-1 bg-transparent border-none outline-none text-base text-t-bright placeholder-t-muted/50 font-mono disabled:opacity-50"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="send"
      />
      <button
        type="submit"
        data-testid="send-button"
        {disabled}
        class="min-h-11 shrink-0 border border-t-muted/40 px-3 text-t-bright hover:border-t-primary hover:text-t-primary disabled:opacity-50"
      >
        [ SEND ]
      </button>
    </form>
  {/if}
</div>
