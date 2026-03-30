<script lang="ts">
  import { onMount } from 'svelte';
  import { briefStore } from '$lib/domain/brief-store.svelte';
  import BriefList from '$lib/components/BriefList.svelte';

  onMount(() => {
    void briefStore.loadBriefs();
  });
</script>

<BriefList />
