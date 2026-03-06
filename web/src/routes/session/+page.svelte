<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
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
</script>

<main class="min-h-screen bg-black text-green-400 font-mono p-4 flex flex-col h-screen max-w-4xl mx-auto">
  <Header />
  <NarrationBox />
  <StatusBar />
  <InputBox />
  <HelpModal />
</main>
