<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { briefStore } from '$lib/domain/brief-store.svelte';
  import { mobileDetect } from '$lib/domain/mobile-detect.svelte';
  import BriefForm from '$lib/components/BriefForm.svelte';
  import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

  const briefId = $derived(page.params.id);

  onMount(() => {
    if (mobileDetect.isMobile) {
      goto('/', { replaceState: true });
      return;
    }
    if (briefId) {
      void briefStore.loadBrief(briefId);
    }
  });
</script>

{#if briefStore.status === 'loading' && !briefStore.activeBrief}
  <main class="bg-t-bg text-t-primary font-mono p-4 flex items-center justify-center h-screen">
    <TerminalSpinner text="Loading brief..." />
  </main>
{:else if briefStore.error && !briefStore.activeBrief}
  <main class="bg-t-bg text-t-primary font-mono p-4 flex items-center justify-center h-screen">
    <p class="text-t-error">{briefStore.error}</p>
  </main>
{:else if briefStore.activeBrief}
  <BriefForm initialData={briefStore.activeBrief} />
{/if}
