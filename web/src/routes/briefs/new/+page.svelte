<script lang="ts">
  import { briefStore } from '$lib/domain/brief-store.svelte';
  import BriefForm from '$lib/components/BriefForm.svelte';

  const duplicate = briefStore.consumeDuplicate();
  const initialData = duplicate
    ? { ...duplicate, id: '', title_hint: duplicate.title_hint ? `Copy of ${duplicate.title_hint}` : null }
    : undefined;
</script>

<BriefForm {initialData} />
