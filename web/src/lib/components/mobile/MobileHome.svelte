<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { authStore } from '$lib/domain/auth-store.svelte';
  import MobileTopBar from './MobileTopBar.svelte';
  import MobileCarousel from './MobileCarousel.svelte';
  import SignedImage from '$lib/components/SignedImage.svelte';
  import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

  type MobileView = 'menu' | 'new-game';

  let view = $state<MobileView>('menu');
  let startingBlueprintId = $state<string | null>(null);

  const inProgressCount = $derived(gameSessionStore.sessionCatalog.counts.in_progress);
  const completedCount = $derived(gameSessionStore.sessionCatalog.counts.completed);
  const hasInProgress = $derived(inProgressCount > 0);
  const hasCompleted = $derived(completedCount > 0);
  const isLoadingBlueprints = $derived(
    gameSessionStore.status === 'loading' && gameSessionStore.blueprints.length === 0
  );

  onMount(() => {
    void gameSessionStore.loadSessionCatalog(true);
  });

  async function enterNewGameFlow() {
    view = 'new-game';
    if (gameSessionStore.blueprints.length === 0 && gameSessionStore.status === 'idle') {
      await gameSessionStore.loadBlueprints();
    }
  }

  function backToMenu() {
    view = 'menu';
    gameSessionStore.error = null;
  }

  async function handleBlueprintTap(blueprint: { id: string }, _index: number) {
    startingBlueprintId = blueprint.id;
    await gameSessionStore.startGame(blueprint.id);
    if (gameSessionStore.status === 'active') {
      await goto('/session');
    }
    startingBlueprintId = null;
  }
</script>

{#if view === 'menu'}
  <main class="flex flex-col h-screen bg-t-bg font-mono">
    <!-- Header area -->
    <div class="flex items-center justify-between px-4 pt-6 pb-2">
      <h1 class="text-xl font-bold text-t-bright">MYSTERY TERMINAL</h1>
      <button
        type="button"
        class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted active:border-t-primary active:text-t-primary"
        onclick={() => authStore.signOut()}
        data-testid="mobile-home-logout"
      >
        LOGOUT
      </button>
    </div>

    <!-- Centered button group -->
    <div class="flex-1 flex flex-col items-center justify-center gap-4 px-6">
      <button
        type="button"
        class="w-full max-w-xs min-h-[48px] border border-t-primary text-t-bright font-bold py-3 px-4 text-base active:bg-t-primary/10"
        onclick={enterNewGameFlow}
        data-testid="mobile-home-new-game"
      >
        Start New Case
      </button>

      <button
        type="button"
        class="w-full max-w-xs min-h-[48px] border py-3 px-4 text-base {hasInProgress
          ? 'border-t-primary text-t-bright font-bold active:bg-t-primary/10'
          : 'border-t-muted/30 text-t-muted/40 cursor-not-allowed'}"
        disabled={!hasInProgress}
        onclick={() => goto('/sessions/in-progress')}
        data-testid="mobile-home-resume"
      >
        Resume Case ({inProgressCount})
      </button>

      <button
        type="button"
        class="w-full max-w-xs min-h-[48px] border py-3 px-4 text-base {hasCompleted
          ? 'border-t-primary text-t-bright font-bold active:bg-t-primary/10'
          : 'border-t-muted/30 text-t-muted/40 cursor-not-allowed'}"
        disabled={!hasCompleted}
        onclick={() => goto('/sessions/completed')}
        data-testid="mobile-home-history"
      >
        Case History ({completedCount})
      </button>
    </div>

    <!-- Loading / error indicators -->
    {#if gameSessionStore.sessionCatalogStatus === 'loading'}
      <div class="pb-8 text-center">
        <TerminalSpinner text="Loading..." />
      </div>
    {:else if gameSessionStore.sessionCatalogStatus === 'error'}
      <div class="pb-8 text-center text-xs text-t-warning px-4">
        Session catalog unavailable.
      </div>
    {/if}
  </main>
{:else}
  <!-- New-game view with blueprint carousel -->
  <main class="flex flex-col h-screen bg-t-bg font-mono">
    <MobileTopBar title="Choose a Mystery" onback={backToMenu} showMenu={false} />

    {#if startingBlueprintId}
      <div class="flex-1 flex items-center justify-center">
        <div class="text-center space-y-4">
          <p class="text-t-bright text-lg">[ INITIALIZING ]</p>
          <TerminalSpinner text="Booting mystery session..." />
        </div>
      </div>
    {:else if gameSessionStore.error}
      <div class="flex-1 flex items-center justify-center px-4">
        <p class="text-t-error text-sm">{gameSessionStore.error}</p>
      </div>
    {:else}
      <div class="flex-1 min-h-0 flex flex-col justify-center">
        <MobileCarousel
          items={gameSessionStore.blueprints}
          onselect={handleBlueprintTap}
          loading={isLoadingBlueprints}
          emptyMessage="No blueprints available"
        >
          {#snippet children(blueprint, _i)}
            <div class="border border-t-muted/30 bg-t-bg p-4 space-y-3">
              {#if blueprint.blueprint_image_id}
                <SignedImage
                  blueprintId={blueprint.id}
                  imageId={blueprint.blueprint_image_id}
                  alt="Case art"
                  class="w-full object-cover"
                  placeholderText="Case image unavailable"
                />
              {/if}
              <h2 class="text-t-bright font-bold">{blueprint.title}</h2>
              <p class="text-t-muted/80 text-sm">{blueprint.one_liner}</p>
              <p class="text-t-dim text-xs">Target age: {blueprint.target_age}</p>
            </div>
          {/snippet}
        </MobileCarousel>
      </div>

      <div class="py-4 text-center text-t-muted/60 text-xs animate-pulse">
        TAP CARD TO START
      </div>
    {/if}
  </main>
{/if}
