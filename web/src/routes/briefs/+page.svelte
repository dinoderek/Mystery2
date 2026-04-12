<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { briefStore } from '$lib/domain/brief-store.svelte';
  import { mobileDetect } from '$lib/domain/mobile-detect.svelte';
  import BriefList from '$lib/components/BriefList.svelte';

  onMount(() => {
    if (mobileDetect.isMobile) {
      goto('/', { replaceState: true });
      return;
    }
    void briefStore.loadBriefs();
  });
</script>

<BriefList />
