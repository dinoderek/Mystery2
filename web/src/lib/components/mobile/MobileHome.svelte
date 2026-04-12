<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { authStore } from '$lib/domain/auth-store.svelte';
  import { MobileHomeState } from '$lib/domain/mobile-home.svelte';
  import MobileTopBar from './MobileTopBar.svelte';
  import MobileCarousel from './MobileCarousel.svelte';
  import SignedImage from '$lib/components/SignedImage.svelte';
  import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

  const home = new MobileHomeState();

  onMount(() => {
    void gameSessionStore.loadSessionCatalog(true);
  });

  async function handleBlueprintTap(blueprint: { id: string }, _index: number) {
    const success = await home.startBlueprint(blueprint.id);
    if (success) {
      await goto('/session');
    }
  }
</script>

{#if home.view === 'menu'}
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
        onclick={() => home.enterNewGameFlow()}
        data-testid="mobile-home-new-game"
      >
        Start New Case
      </button>

      <button
        type="button"
        class="w-full max-w-xs min-h-[48px] border py-3 px-4 text-base {home.hasInProgress
          ? 'border-t-primary text-t-bright font-bold active:bg-t-primary/10'
          : 'border-t-muted/30 text-t-muted/40 cursor-not-allowed'}"
        disabled={!home.hasInProgress}
        onclick={() => goto('/sessions/in-progress')}
        data-testid="mobile-home-resume"
      >
        Resume Case ({home.inProgressCount})
      </button>

      <button
        type="button"
        class="w-full max-w-xs min-h-[48px] border py-3 px-4 text-base {home.hasCompleted
          ? 'border-t-primary text-t-bright font-bold active:bg-t-primary/10'
          : 'border-t-muted/30 text-t-muted/40 cursor-not-allowed'}"
        disabled={!home.hasCompleted}
        onclick={() => goto('/sessions/completed')}
        data-testid="mobile-home-history"
      >
        Case History ({home.completedCount})
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
    <MobileTopBar title="Choose a Mystery" onback={() => home.backToMenu()} showMenu={false} />

    {#if home.startingBlueprintId}
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
          loading={home.isLoadingBlueprints}
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
