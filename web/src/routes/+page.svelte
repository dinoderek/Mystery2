<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { authStore } from '$lib/domain/auth-store.svelte';
  import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';
  import StoryImagePanel from '$lib/components/StoryImagePanel.svelte';

  type LandingView = 'menu' | 'new-game';

  let view = $state<LandingView>('menu');

  const hasInProgress = $derived(gameSessionStore.sessionCatalog.counts.in_progress > 0);
  const hasCompleted = $derived(gameSessionStore.sessionCatalog.counts.completed > 0);
  const isStartingGame = $derived(view === 'new-game' && gameSessionStore.status === 'loading' && gameSessionStore.blueprints.length > 0);

  onMount(() => {
    void gameSessionStore.loadSessionCatalog(true);
  });

  async function enterNewGameFlow() {
    view = 'new-game';
    if (gameSessionStore.blueprints.length === 0 && gameSessionStore.status === 'idle') {
      await gameSessionStore.loadBlueprints();
    } else {
      await gameSessionStore.refreshBlueprintImageLinks();
    }
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (isStartingGame) {
      return;
    }

    const key = event.key.toLowerCase();

    if (view === 'menu') {
      if (key === '1') {
        await enterNewGameFlow();
        return;
      }

      if (key === '2' && hasInProgress) {
        await goto('/sessions/in-progress');
        return;
      }

      if (key === '3' && hasCompleted) {
        await goto('/sessions/completed');
      }

      return;
    }

    if (key === 'b') {
      view = 'menu';
      gameSessionStore.error = null;
      return;
    }

    const index = Number.parseInt(event.key, 10);
    if (!Number.isFinite(index) || index < 1 || index > gameSessionStore.blueprints.length) {
      return;
    }

    const blueprint = gameSessionStore.blueprints[index - 1];
    await gameSessionStore.startGame(blueprint.id);
    if (gameSessionStore.status === 'active') {
      await goto('/session');
    }
  }

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
      <div class="flex items-center justify-between mb-2">
        <h1 class="text-3xl font-bold">MYSTERY GAME TERMINAL</h1>
        <button
          type="button"
          class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted hover:border-t-primary hover:text-t-primary"
          onclick={() => authStore.signOut()}
        >
          LOGOUT
        </button>
      </div>

      {#if view === 'menu'}
        <p class="text-t-muted/70 mb-8 border-b border-t-muted/30 pb-4">Select where to continue</p>
        <div class="space-y-3 text-base">
          <p class="text-t-bright">1. Start a new game</p>
          <p class={`${hasInProgress ? 'text-t-bright' : 'text-t-muted/40 line-through'}`}>
            2. View in-progress games
            <span class="text-xs text-t-muted/80">({gameSessionStore.sessionCatalog.counts.in_progress})</span>
          </p>
          <p class={`${hasCompleted ? 'text-t-bright' : 'text-t-muted/40 line-through'}`}>
            3. View completed games
            <span class="text-xs text-t-muted/80">({gameSessionStore.sessionCatalog.counts.completed})</span>
          </p>
        </div>

        {#if gameSessionStore.sessionCatalogStatus === 'loading'}
          <div class="mt-6">
            <TerminalSpinner text="Loading session catalog..." />
          </div>
        {:else if gameSessionStore.sessionCatalogStatus === 'error'}
          <p class="mt-6 text-xs text-t-warning">
            Session catalog unavailable. In-progress and completed options stay disabled.
          </p>
        {/if}

        <div class="mt-8 text-center text-t-muted/60 animate-pulse">
          [ PRESS 1, 2, OR 3 ]
        </div>
      {:else}
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
              <div class="group relative grid gap-3 border border-t-muted/20 p-4 transition-colors hover:border-t-primary md:grid-cols-[minmax(0,1fr)_11rem]">
                <div class="absolute -left-3 -top-3 w-6 h-6 bg-t-bg border border-t-primary flex items-center justify-center font-bold">
                  {i + 1}
                </div>
                <div>
                  <h2 class="text-xl font-bold text-t-bright">{blueprint.title}</h2>
                  <p class="text-t-muted/80 mb-2">{blueprint.one_liner}</p>
                  <p class="text-xs text-t-dim">Target age: {blueprint.target_age}</p>
                </div>
                {#if blueprint.blueprint_image_id}
                  <StoryImagePanel
                    title="Case art"
                    imageUrl={blueprint.blueprint_image_url}
                    placeholder={Boolean(blueprint.blueprint_image_placeholder)}
                    placeholderText="Case image unavailable"
                    compact={true}
                  />
                {/if}
              </div>
            {/each}
          </div>
          <div class="mt-8 text-center text-t-muted/60 animate-pulse">
            [ PRESS NUMBER TO START OR B TO GO BACK ]
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</main>
