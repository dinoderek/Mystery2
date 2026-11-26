<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import ListFooter from '$lib/components/ListFooter.svelte';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import type { SessionSummary } from '$lib/types/game';
  import { formatLastPlayed, formatOutcome, pickSessionByNumericKey } from '$lib/domain/session-list';

  let message = $state<string | null>(null);

  const sessions = $derived(gameSessionStore.sessionCatalog.completed);

  onMount(() => {
    void gameSessionStore.loadSessionCatalog(true);
  });

  async function openSession(selected: SessionSummary) {
    if (!selected.mystery_available) {
      message = 'Cannot open: mystery file is unavailable.';
      return;
    }

    message = null;
    await gameSessionStore.resumeSession(selected.game_id);
    if (gameSessionStore.status === 'active') {
      await goto('/session');
      return;
    }

    message = gameSessionStore.needsReadingAge ? null : (gameSessionStore.error ?? 'Unable to reopen this session.');
  }

  // A tap on a row calls `openSession`, as its number key does.
  async function handleKeydown(event: KeyboardEvent) {
    if (event.key.toLowerCase() === 'b') {
      await goto('/');
      return;
    }

    const selected = pickSessionByNumericKey(event.key, sessions);
    if (selected) {
      await openSession(selected);
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<main class="bg-t-bg text-t-primary font-mono p-4 flex flex-col h-dvh max-w-6xl mx-auto">
  <!-- Fixed header -->
  <div class="mb-4">
    <h1 class="text-2xl font-bold mb-2">COMPLETED SESSIONS</h1>
    <p class="text-t-muted/70 border-b border-t-muted/30 pb-4">Pick a session to review. Tap a row or press its number. Press `b` to go back.</p>
  </div>

  <!-- Scrollable middle -->
  <div class="flex-1 min-h-0 overflow-y-auto border border-t-muted/30 p-4">
    {#if gameSessionStore.sessionCatalogStatus === 'loading' && sessions.length === 0}
      <p>Loading completed sessions...</p>
    {:else if gameSessionStore.sessionCatalogStatus === 'error' && sessions.length === 0}
      <p class="text-t-warning">
        Session list unavailable{gameSessionStore.sessionCatalogError
          ? `: ${gameSessionStore.sessionCatalogError}`
          : ''}.
      </p>
    {:else if sessions.length === 0}
      <p class="text-t-muted/80">No completed sessions found.</p>
    {:else}
      <div class="space-y-3">
        {#each sessions as session, i}
          <button
            type="button"
            data-testid={`session-row-${i + 1}`}
            disabled={!session.mystery_available}
            class={`relative block w-full min-h-11 border p-4 text-left ${session.mystery_available ? 'border-t-muted/20 hover:border-t-primary' : 'border-t-warning/40 opacity-70'}`}
            onclick={() => openSession(session)}
          >
            <span class="absolute -left-3 -top-3 w-6 h-6 bg-t-bg border border-t-primary flex items-center justify-center font-bold">
              {i + 1}
            </span>
            <span class="block font-bold text-t-bright">{session.mystery_title}</span>
            <span class="block text-sm text-t-muted/90">Outcome: {formatOutcome(session.outcome)}</span>
            <span class="block text-xs text-t-muted/80">Last played: {formatLastPlayed(session.last_played_at)}</span>
            {#if !session.mystery_available}
              <span class="block text-xs text-t-warning mt-2">Cannot open: mystery file is unavailable.</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if message}
      <p class="mt-4 text-sm text-t-warning">{message}</p>
    {/if}
  </div>

  <ListFooter hint="PRESS A NUMBER · B GOES BACK" onback={() => goto('/')} />
</main>
