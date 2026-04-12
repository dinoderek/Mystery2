<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { formatLastPlayed, formatOutcome, pickSessionByNumericKey } from '$lib/domain/session-list';
  import MobileBackButton from '$lib/components/MobileBackButton.svelte';
  import { mobileKeyboard } from '$lib/domain/mobile-keyboard.svelte';
  import { mobileDetect } from '$lib/domain/mobile-detect.svelte';
  import MobileTopBar from '$lib/components/mobile/MobileTopBar.svelte';
  import MobileCarousel from '$lib/components/mobile/MobileCarousel.svelte';
  import type { SessionSummary } from '$lib/types/game';

  let message = $state<string | null>(null);
  let mobileLoading = $state(false);

  const sessions = $derived(gameSessionStore.sessionCatalog.completed);

  onMount(() => {
    void gameSessionStore.loadSessionCatalog(true);
    if (!mobileDetect.isMobile) {
      mobileKeyboard.inputMode = 'numeric';
      return () => {
        mobileKeyboard.inputMode = 'none';
      };
    }
  });

  async function goBack() {
    await goto('/');
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (mobileDetect.isMobile) return;
    const key = event.key.toLowerCase();

    if (key === 'b') {
      await goto('/');
      return;
    }

    const selected = pickSessionByNumericKey(event.key, sessions);
    if (!selected) {
      return;
    }

    if (!selected.can_open) {
      message = 'Cannot open: mystery file is unavailable.';
      return;
    }

    message = null;
    await gameSessionStore.resumeSession(selected.game_id);
    if (gameSessionStore.status === 'active') {
      await goto('/session');
      return;
    }

    message = gameSessionStore.error ?? 'Unable to reopen this session.';
  }

  async function handleMobileSelect(session: SessionSummary) {
    if (!session.can_open) {
      message = 'Mystery file unavailable';
      return;
    }

    message = null;
    mobileLoading = true;
    await gameSessionStore.resumeSession(session.game_id);
    mobileLoading = false;

    if (gameSessionStore.status === 'active') {
      await goto('/session');
      return;
    }

    message = gameSessionStore.error ?? 'Unable to reopen this session.';
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if !mobileDetect.isMobile}
<MobileBackButton onback={goBack} />

<main class="bg-t-bg text-t-primary font-mono p-4 flex flex-col h-screen max-w-6xl mx-auto">
  <!-- Fixed header -->
  <div class="mb-4">
    <h1 class="text-2xl font-bold mb-2">COMPLETED SESSIONS</h1>
    <p class="text-t-muted/70 border-b border-t-muted/30 pb-4">Pick a session number to review. Press `b` to go back.</p>
  </div>

  <!-- Scrollable middle -->
  <div class="flex-1 min-h-0 overflow-y-auto border border-t-muted/30 p-4">
    {#if gameSessionStore.sessionCatalogStatus === 'loading' && sessions.length === 0}
      <p>Loading completed sessions...</p>
    {:else if sessions.length === 0}
      <p class="text-t-muted/80">No completed sessions found.</p>
    {:else}
      <div class="space-y-3">
        {#each sessions as session, i}
          <div class={`relative border p-4 ${session.can_open ? 'border-t-muted/20' : 'border-t-warning/40 opacity-70'}`}>
            <div class="absolute -left-3 -top-3 w-6 h-6 bg-t-bg border border-t-primary flex items-center justify-center font-bold">
              {i + 1}
            </div>
            <p class="font-bold text-t-bright">{session.mystery_title}</p>
            <p class="text-sm text-t-muted/90">Outcome: {formatOutcome(session.outcome)}</p>
            <p class="text-xs text-t-muted/80">Last played: {formatLastPlayed(session.last_played_at)}</p>
            {#if !session.can_open}
              <p class="text-xs text-t-warning mt-2">Cannot open: mystery file is unavailable.</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if message}
      <p class="mt-4 text-sm text-t-warning">{message}</p>
    {/if}
  </div>

  <!-- Fixed footer -->
  <div class="mt-4 text-center text-t-muted/60 animate-pulse">
    [ PRESS NUMBER TO REVIEW OR B TO RETURN ]
  </div>
</main>
{:else}
<div class="flex flex-col h-screen bg-t-bg font-mono">
  <MobileTopBar title="Case History" onback={() => goto('/')} showMenu={false} />

  <div class="flex-1 flex flex-col min-h-0 py-4">
    <MobileCarousel
      items={sessions}
      loading={gameSessionStore.sessionCatalogStatus === 'loading' && sessions.length === 0}
      emptyMessage="No completed cases"
      onselect={(item) => handleMobileSelect(item)}
    >
      {#snippet children(session: SessionSummary)}
        <div class="border border-t-muted/30 bg-t-bg p-4 {!session.can_open ? 'opacity-50' : ''}">
          <p class="text-t-bright font-bold">{session.mystery_title}</p>
          <p class="text-t-muted/90 text-sm mt-1">Outcome: {formatOutcome(session.outcome)}</p>
          <p class="text-t-muted/80 text-xs mt-1">Last played: {formatLastPlayed(session.last_played_at)}</p>
          {#if !session.can_open}
            <p class="text-t-warning text-xs mt-2">Mystery file unavailable</p>
          {/if}
        </div>
      {/snippet}
    </MobileCarousel>
  </div>

  {#if message}
    <p class="text-center text-sm text-t-warning px-4 py-2">{message}</p>
  {/if}

  {#if mobileLoading}
    <p class="text-center text-t-muted/60 text-xs py-2 animate-pulse">Loading...</p>
  {:else if sessions.length > 0}
    <p class="text-center text-t-muted/60 text-xs py-2 animate-pulse">TAP CARD TO VIEW</p>
  {/if}
</div>
{/if}
