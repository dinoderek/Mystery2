<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

  onMount(() => {
    gameSessionStore.loadBlueprints();
  });

  async function handleKeydown(event: KeyboardEvent) {
    if (gameSessionStore.status === 'loading') return;

    const key = parseInt(event.key);
    if (!isNaN(key) && key > 0 && key <= gameSessionStore.blueprints.length) {
      const blueprint = gameSessionStore.blueprints[key - 1];
      await gameSessionStore.startGame(blueprint.id);
      if (gameSessionStore.status === 'active') {
        goto('/session');
      }
    }
  }

  const isStartingGame = $derived(gameSessionStore.status === 'loading' && gameSessionStore.blueprints.length > 0);
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="min-h-screen bg-t-bg text-t-primary p-8 font-mono">
  {#if isStartingGame}
    <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center">
      <div class="text-center space-y-4">
        <p class="text-t-bright text-lg">[ INITIALIZING HYPER-NEURAL NARRATIVE ENGINE ]</p>
        <TerminalSpinner text="Booting mystery session..." />
      </div>
    </div>
  {:else}
    <div class="max-w-2xl mx-auto border border-t-muted/30 p-8 rounded">
      <h1 class="text-3xl font-bold mb-2">MYSTERY GAME TERMINAL</h1>
      <p class="text-t-muted/70 mb-8 border-b border-t-muted/30 pb-4">Select a case blueprint to begin investigation</p>

      {#if gameSessionStore.status === 'loading' && gameSessionStore.blueprints.length === 0}
        <TerminalSpinner text="Loading available blueprints..." />
      {:else if gameSessionStore.error}
        <p class="text-t-error">Error: {gameSessionStore.error}</p>
      {:else if gameSessionStore.blueprints.length === 0}
        <p>No blueprints available.</p>
      {:else}
        <div class="space-y-4">
          {#each gameSessionStore.blueprints as blueprint, i}
            <div class="group relative p-4 border border-t-muted/20 hover:border-t-primary transition-colors">
              <div class="absolute -left-3 -top-3 w-6 h-6 bg-t-bg border border-t-primary flex items-center justify-center font-bold">
                {i + 1}
              </div>
              <h2 class="text-xl font-bold text-t-bright">{blueprint.title}</h2>
              <p class="text-t-muted/80 mb-2">{blueprint.one_liner}</p>
              <p class="text-xs text-t-dim">Target age: {blueprint.target_age}</p>
            </div>
          {/each}
        </div>
        <div class="mt-8 text-center text-t-muted/60 animate-pulse">
          [ PRESS NUMBER KEY TO SELECT CASE ]
        </div>
      {/if}
    </div>
  {/if}
</main>
