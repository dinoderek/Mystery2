<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { authStore } from '$lib/domain/auth-store.svelte';
  import Header from '$lib/components/Header.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import NarrationBox from '$lib/components/NarrationBox.svelte';
  import InputBox from '$lib/components/InputBox.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';

  onMount(() => {
    if (gameSessionStore.status !== 'active' || !gameSessionStore.game_id) {
      goto('/');
    }
  });

  async function handleKeydown(event: KeyboardEvent) {
    if (!gameSessionStore.awaitingReturnToList && gameSessionStore.viewerMode !== 'read_only_completed') {
      return;
    }

    event.preventDefault();
    gameSessionStore.clearSessionForMysteryList();
    await goto('/');
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="min-h-screen bg-t-bg text-t-primary font-mono p-4 flex flex-col h-screen max-w-4xl mx-auto">
  <div class="mb-2 flex justify-end">
    <button
      type="button"
      class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted hover:border-t-primary hover:text-t-primary"
      onclick={() => authStore.signOut()}
    >
      LOGOUT
    </button>
  </div>
  <Header />
  <NarrationBox />
  <StatusBar />
  <InputBox />
  <HelpModal />
</main>
