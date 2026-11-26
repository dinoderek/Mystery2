<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import ListFooter from '$lib/components/ListFooter.svelte';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { playerStore } from '$lib/domain/player-store.svelte';
  import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';
  import CaseArtwork from '$lib/components/CaseArtwork.svelte';
  import { landingRows, pickLandingChoice, pickNumbered, type LandingChoice } from '$lib/domain/landing-menu';

  type LandingView = 'menu' | 'new-game';

  let view = $state<LandingView>('menu');

  const rows = $derived(landingRows(gameSessionStore.sessionCatalog.counts));
  let isStartingGame = $state(false);

  onMount(() => {
    void gameSessionStore.loadSessionCatalog(true);
  });

  function backToMenu() {
    view = 'menu';
    gameSessionStore.error = null;
  }

  async function enterNewGameFlow() {
    view = 'new-game';
    // Asked again on every visit, after a failed load too: each case's line is
    // narrated at the profile's age as it is now, and nothing caches it.
    if (gameSessionStore.status !== 'loading') {
      await gameSessionStore.loadBlueprints();
    }
  }

  async function choose(choice: LandingChoice) {
    if (choice === 'new-game') {
      await enterNewGameFlow();
    } else {
      await goto(choice === 'in-progress' ? '/sessions/in-progress' : '/sessions/completed');
    }
  }

  async function startCase(blueprintId: string) {
    if (isStartingGame) {
      return;
    }

    isStartingGame = true;
    try {
      await gameSessionStore.startGame(blueprintId);
      if (gameSessionStore.status === 'active') {
        await goto('/session');
      }
    } finally {
      isStartingGame = false;
    }
  }

  // A tap calls the same functions as the key: `choose`, `startCase`, `backToMenu`.
  async function handleKeydown(event: KeyboardEvent) {
    if (isStartingGame) {
      return;
    }

    const key = event.key.toLowerCase();

    if (view === 'menu') {
      const choice = pickLandingChoice(key, gameSessionStore.sessionCatalog.counts);
      if (choice) {
        await choose(choice);
      }
      return;
    }

    if (key === 'b') {
      backToMenu();
      return;
    }

    const blueprint = pickNumbered(event.key, gameSessionStore.blueprints);
    if (blueprint) {
      await startCase(blueprint.id);
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<main class="bg-t-bg text-t-primary font-mono p-4 flex flex-col h-dvh max-w-6xl mx-auto">
  {#if isStartingGame}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-4">
        <p class="text-t-bright text-lg">[ INITIALIZING HYPER-NEURAL NARRATIVE ENGINE ]</p>
        <TerminalSpinner text="Booting mystery session..." />
      </div>
    </div>
  {:else}
    <!-- Fixed header -->
    <div class="mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h1 class="text-3xl font-bold">MYSTERY</h1>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="settings-link"
            class="min-h-11 border border-t-muted/40 px-3 text-xs text-t-muted hover:border-t-primary hover:text-t-primary"
            onclick={() => goto('/settings')}
          >
            SETTINGS
          </button>
          <button
            type="button"
            class="min-h-11 border border-t-muted/40 px-3 text-xs text-t-muted hover:border-t-primary hover:text-t-primary"
            onclick={() => playerStore.signOut()}
          >
            LOGOUT
          </button>
        </div>
      </div>

      {#if view === 'menu'}
        <p class="text-t-muted/70 border-b border-t-muted/30 pb-4">Select where to continue</p>
      {:else}
        <p class="text-t-muted/70 border-b border-t-muted/30 pb-4">Select your adventure</p>
      {/if}
    </div>

    <!-- Scrollable middle -->
    <div class="flex-1 min-h-0 overflow-y-auto border border-t-muted/30 p-4">
      {#if view === 'menu'}
        <div class="space-y-3 text-base">
          {#each rows as row (row.number)}
            <button
              type="button"
              data-testid={`menu-row-${row.number}`}
              disabled={!row.enabled}
              class={`block w-full min-h-11 text-left ${row.enabled ? 'text-t-bright hover:text-t-primary' : 'text-t-muted/40 line-through'}`}
              onclick={() => choose(row.choice)}
            >
              {row.number}. {row.label}
              {#if row.count !== null}
                <span class="text-xs text-t-muted/80">({row.count})</span>
              {/if}
            </button>
          {/each}
        </div>

        {#if gameSessionStore.sessionCatalogStatus === 'loading'}
          <div class="mt-6">
            <TerminalSpinner text="Loading session catalog..." />
          </div>
        {:else if gameSessionStore.sessionCatalogStatus === 'error'}
          <p class="mt-6 text-xs text-t-warning">
            Session catalog unavailable{gameSessionStore.sessionCatalogError
              ? `: ${gameSessionStore.sessionCatalogError}`
              : ''}. In-progress and completed options stay disabled.
          </p>
        {/if}
      {:else}
        <!--
          The error sits above the list rather than in place of it. A failed
          start is worth retrying from the same screen, and replacing the cases
          left going back and coming in again — which clears `error` — as the
          only way to reach them.
        -->
        {#if gameSessionStore.error}
          <p class="text-t-error mb-4">Error: {gameSessionStore.error}</p>
        {/if}
        {#if gameSessionStore.status === 'loading' && gameSessionStore.blueprints.length === 0}
          <TerminalSpinner text="Loading available blueprints..." />
        {:else if gameSessionStore.blueprints.length === 0}
          <p>No blueprints available.</p>
        {:else}
          <div class="space-y-4">
            {#each gameSessionStore.blueprints as blueprint, i}
              <!-- The button's ::after covers the card, so the whole card taps; the art stays outside it. -->
              <div class="group relative flex flex-col md:flex-row gap-3 border border-t-muted/20 p-4 transition-colors hover:border-t-primary">
                <span class="absolute -left-3 -top-3 z-10 w-6 h-6 bg-t-bg border border-t-primary flex items-center justify-center font-bold">
                  {i + 1}
                </span>
                <div class="md:w-1/2 md:order-2">
                  <CaseArtwork blueprintId={blueprint.id} imageId={blueprint.blueprint_image_id} alt="Case art" />
                </div>
                <button
                  type="button"
                  data-testid={`case-card-${i + 1}`}
                  class="block text-left md:w-1/2 md:order-1 after:absolute after:inset-0 after:content-['']"
                  onclick={() => startCase(blueprint.id)}
                >
                  <span class="block text-xl font-bold text-t-bright">{blueprint.title}</span>
                  {#if blueprint.one_liner}
                    <span class="block text-t-muted/80 mb-2" data-testid={`case-line-${i + 1}`}>{blueprint.one_liner}</span>
                  {:else if gameSessionStore.oneLinerStatus === 'loading'}
                    <span class="block text-t-muted/50 mb-2 motion-safe:animate-pulse" data-testid={`case-line-loading-${i + 1}`} aria-label="Loading the case's line">...</span>
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    {#if view === 'menu'}
      <ListFooter hint="PRESS 1, 2 OR 3" />
    {:else}
      <ListFooter hint="PRESS A NUMBER · B GOES BACK" onback={backToMenu} />
    {/if}
  {/if}
</main>
