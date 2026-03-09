<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore, type ThemeName } from '$lib/domain/store.svelte';
  import { authStore } from '$lib/domain/auth-store.svelte';
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

  const themeOptions: ThemeName[] = ['matrix', 'amber'];

  function selectTheme(theme: ThemeName) {
    gameSessionStore.setTheme(theme);
  }

  const isStartingGame = $derived(gameSessionStore.status === 'loading' && gameSessionStore.blueprints.length > 0);
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="min-h-screen bg-t-bg text-t-primary p-8 font-mono">
  <div class="mx-auto mb-4 flex max-w-2xl justify-end">
    <button
      type="button"
      class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted hover:border-t-primary hover:text-t-primary"
      onclick={() => authStore.signOut()}
    >
      LOGOUT
    </button>
  </div>
  {#if isStartingGame}
    <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center">
      <div class="text-center space-y-4">
        <p class="text-t-bright text-lg">[ INITIALIZING HYPER-NEURAL NARRATIVE ENGINE ]</p>
        <TerminalSpinner text="Booting mystery session..." />
      </div>
    </div>
  {:else}
    <div class="max-w-2xl mx-auto border border-t-muted/30 p-8 rounded">
      <div class="mb-4 flex items-center justify-end gap-2 text-xs">
        <span class="text-t-muted/70">THEME</span>
        {#each themeOptions as theme}
          <button
            type="button"
            class={`cursor-pointer border px-2 py-1 transition-colors ${
              gameSessionStore.theme === theme
                ? 'border-t-bright text-t-bright bg-t-muted/10'
                : 'border-t-muted/40 text-t-muted/80 hover:bg-t-muted/10'
            }`}
            onclick={() => selectTheme(theme)}
            data-testid={`theme-${theme}`}
          >
            {theme.toUpperCase()}
          </button>
        {/each}
      </div>
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
