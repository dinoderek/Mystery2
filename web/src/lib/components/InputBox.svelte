<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";

  let inputValue = $state("");
  let inputElement = $state<HTMLInputElement | null>(null);
  let hasFocusedInput = $state(false);

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

    inputElement.focus();
    hasFocusedInput = true;
  });

  async function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && inputValue.trim() && !disabled) {
      e.stopPropagation();
      const text = inputValue;
      inputValue = "";
      await gameSessionStore.submitInput(text);
    }
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
      <p class="text-t-bright animate-pulse" data-testid="return-to-list-prompt">
        [ TAB: REVIEW NOTEBOOK &middot; ANY OTHER KEY: BACK TO THE MYSTERY LIST ]
      </p>
    </div>
  {:else if showBeginPrompt}
    <p class="text-t-bright animate-pulse text-sm" data-testid="begin-investigation-prompt">
      [ PRESS ANY KEY TO BEGIN THE INVESTIGATION ]
    </p>
  {:else}
    {#if gameSessionStore.isRetrying}
      <div class="mb-2 text-xs text-t-warning" data-testid="retry-indicator">
        Retrying request ({gameSessionStore.retryCount}/3)...
      </div>
    {/if}

    <input
      type="text"
      bind:this={inputElement}
      bind:value={inputValue}
      onkeydown={handleKeydown}
      {placeholder}
      {disabled}
      class="w-full bg-transparent border-none outline-none text-t-bright placeholder-t-muted/50 font-mono disabled:opacity-50"
      autocomplete="off"
      spellcheck="false"
    />

  {/if}
</div>
