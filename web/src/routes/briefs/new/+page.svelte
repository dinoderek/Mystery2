<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { briefStore } from '$lib/domain/brief-store.svelte';
  import { mobileDetect } from '$lib/domain/mobile-detect.svelte';
  import BriefForm from '$lib/components/BriefForm.svelte';

  onMount(() => {
    if (mobileDetect.isMobile) {
      goto('/', { replaceState: true });
      return;
    }
  });

  const duplicate = briefStore.consumeDuplicate();
  const initialData = duplicate
    ? { ...duplicate, id: '', title_hint: duplicate.title_hint ? `Copy of ${duplicate.title_hint}` : null }
    : undefined;
</script>

<BriefForm {initialData} />
