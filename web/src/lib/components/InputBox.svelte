<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";

  let inputValue = $state("");

  let placeholder = $derived(
    gameSessionStore.state?.mode === "talk"
      ? "> Talk mode..."
      : gameSessionStore.state?.mode === "accuse"
        ? "> Accuse mode..."
        : gameSessionStore.state?.mode === "ended"
          ? "> Session ended..."
          : "> Explore mode...",
  );

  let disabled = $derived(gameSessionStore.status === "loading");

  async function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && inputValue.trim()) {
      const text = inputValue;
      inputValue = "";
      await gameSessionStore.submitInput(text);
    }
  }

  async function retryLastCommand() {
    await gameSessionStore.retryLastCommand();
  }
</script>

<div class="mt-4 border-t border-green-500/30 pt-4">
  {#if gameSessionStore.awaitingReturnToList}
    <div class="space-y-2 text-sm" data-testid="accusation-end-state">
      {#if gameSessionStore.accusationOutcome === "win"}
        <p class="text-green-300 font-bold">[ CASE SOLVED ]</p>
        <p>The accusation is correct. Justice is served.</p>
      {:else if gameSessionStore.accusationOutcome === "lose"}
        <p class="text-red-300 font-bold">[ CASE UNSOLVED ]</p>
        <p>The accusation is incorrect. The mystery remains unresolved.</p>
      {/if}
      <p class="text-green-300 animate-pulse" data-testid="return-to-list-prompt">
        [ PRESS ANY KEY TO GO BACK TO THE MYSTERY LIST ]
      </p>
    </div>
  {:else}
    {#if gameSessionStore.isRetrying}
      <div class="mb-2 text-xs text-yellow-300" data-testid="retry-indicator">
        Retrying request ({gameSessionStore.retryCount}/3)...
      </div>
    {/if}

    <input
      type="text"
      bind:value={inputValue}
      onkeydown={handleKeydown}
      {placeholder}
      {disabled}
      class="w-full bg-transparent border-none outline-none text-green-300 placeholder-green-500/50 font-mono disabled:opacity-50"
      autocomplete="off"
      spellcheck="false"
      autofocus
    />

    {#if gameSessionStore.lastFailedInput && gameSessionStore.status !== "loading"}
      <button
        type="button"
        onclick={retryLastCommand}
        class="mt-3 border border-yellow-400/60 px-2 py-1 text-xs text-yellow-300 hover:bg-yellow-400/10 cursor-pointer"
        data-testid="retry-last-command"
      >
        [ RETRY LAST COMMAND ]
      </button>
    {/if}
  {/if}
</div>
