<script lang="ts">
  import { goto } from '$app/navigation';
  import { briefStore } from '$lib/domain/brief-store.svelte';
  import type { BriefSummary, BriefFull } from '$lib/types/brief';
  import TerminalSpinner from './TerminalSpinner.svelte';
  import { supabase } from '$lib/api/supabase';

  let focusedIndex = $state(0);
  let confirmArchiveId = $state<string | null>(null);
  let message = $state<string | null>(null);

  const briefs = $derived(briefStore.briefs);
  const isLoading = $derived(briefStore.status === 'loading');

  function clampFocus() {
    if (briefs.length === 0) {
      focusedIndex = 0;
    } else if (focusedIndex >= briefs.length) {
      focusedIndex = briefs.length - 1;
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max).trimEnd() + '…';
  }

  async function editFocused() {
    if (briefs.length === 0) return;
    clampFocus();
    const brief = briefs[focusedIndex];
    await goto(`/briefs/${brief.id}`);
  }

  async function duplicateFocused() {
    if (briefs.length === 0) return;
    clampFocus();
    const brief = briefs[focusedIndex];

    // Load full brief data for duplication
    const { data, error } = await supabase.functions.invoke('briefs-get', {
      body: { brief_id: brief.id },
    });
    if (error || !data?.brief) {
      message = 'Failed to load brief for duplication';
      return;
    }
    briefStore.prepareDuplicate(data.brief as BriefFull);
    await goto('/briefs/new');
  }

  function requestArchiveFocused() {
    if (briefs.length === 0) return;
    clampFocus();
    confirmArchiveId = briefs[focusedIndex].id;
  }

  async function confirmArchive() {
    if (!confirmArchiveId) return;
    const ok = await briefStore.archiveBrief(confirmArchiveId);
    if (ok) {
      message = 'Brief archived.';
      clampFocus();
    }
    confirmArchiveId = null;
  }

  async function downloadFocused() {
    if (briefs.length === 0) return;
    clampFocus();
    const brief = briefs[focusedIndex];

    const { data, error } = await supabase.functions.invoke('briefs-get', {
      body: { brief_id: brief.id },
    });
    if (error || !data?.brief) {
      message = 'Failed to load brief for download';
      return;
    }
    briefStore.downloadAsJson(data.brief as BriefFull);
  }

  async function handleKeydown(event: KeyboardEvent) {
    // Don't intercept when a form element is focused
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const key = event.key;

    // Confirmation dialog takes priority
    if (confirmArchiveId) {
      if (key === 'y' || key === 'Y' || key === 'Enter') {
        event.preventDefault();
        await confirmArchive();
        return;
      }
      if (key === 'n' || key === 'N' || key === 'Escape') {
        event.preventDefault();
        confirmArchiveId = null;
        return;
      }
      return;
    }

    switch (key) {
      case 'n':
        event.preventDefault();
        await goto('/briefs/new');
        return;
      case 'b':
      case 'Escape':
        event.preventDefault();
        await goto('/');
        return;
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        if (briefs.length > 0) focusedIndex = Math.min(focusedIndex + 1, briefs.length - 1);
        return;
      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        if (briefs.length > 0) focusedIndex = Math.max(focusedIndex - 1, 0);
        return;
      case 'e':
      case 'Enter':
        event.preventDefault();
        await editFocused();
        return;
      case 'd':
        event.preventDefault();
        await duplicateFocused();
        return;
      case 'x':
        event.preventDefault();
        requestArchiveFocused();
        return;
      case 'w':
        event.preventDefault();
        await downloadFocused();
        return;
    }

    // Number keys 1-9 jump to row
    const num = parseInt(key, 10);
    if (num >= 1 && num <= briefs.length) {
      event.preventDefault();
      focusedIndex = num - 1;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="bg-t-bg text-t-primary font-mono p-4 flex flex-col h-screen max-w-6xl mx-auto">
  <!-- Header -->
  <div class="mb-4">
    <h1 class="text-2xl font-bold mb-2">STORY BRIEFS</h1>
    <p class="text-t-muted/70 border-b border-t-muted/30 pb-4">
      Manage your mystery story briefs. Press <span class="text-t-bright">n</span> to create a new brief.
    </p>
  </div>

  <!-- Scrollable content -->
  <div class="flex-1 min-h-0 overflow-y-auto border border-t-muted/30 p-4">
    {#if isLoading && briefs.length === 0}
      <TerminalSpinner text="Loading briefs..." />
    {:else if briefStore.error}
      <p class="text-t-error">{briefStore.error}</p>
    {:else if briefs.length === 0}
      <p class="text-t-muted/80" data-testid="briefs-empty">No briefs yet. Press <span class="text-t-bright">n</span> to create your first brief.</p>
    {:else}
      <!-- Archive confirmation -->
      {#if confirmArchiveId}
        <div class="mb-4 border border-t-warning/60 p-3 text-t-warning" data-testid="archive-confirm">
          Archive this brief? Press <span class="font-bold">y</span> to confirm or <span class="font-bold">n</span> to cancel.
        </div>
      {/if}

      <div class="space-y-3">
        {#each briefs as brief, i}
          <button
            type="button"
            class={`relative border p-4 w-full text-left transition-colors ${
              i === focusedIndex
                ? 'border-t-primary ring-1 ring-t-primary'
                : 'border-t-muted/20 hover:border-t-primary/50'
            }`}
            data-testid="brief-row"
            onfocus={() => { focusedIndex = i; }}
            onclick={() => { focusedIndex = i; }}
            ondblclick={editFocused}
          >
            <div class="absolute -left-3 -top-3 w-6 h-6 bg-t-bg border border-t-primary flex items-center justify-center font-bold text-xs">
              {i + 1}
            </div>
            <p class="font-bold text-t-bright">{brief.title_hint || 'Untitled Brief'}</p>
            <p class="text-sm text-t-muted/90 mt-1">{truncate(brief.brief, 120)}</p>
            <div class="flex gap-4 mt-2 text-xs text-t-muted/70">
              <span>Age: {brief.target_age}</span>
              <span>Updated: {formatDate(brief.updated_at)}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    {#if message}
      <p class="mt-4 text-sm text-t-muted/80" data-testid="brief-list-message">{message}</p>
    {/if}
  </div>

  <!-- Footer -->
  <div class="mt-4 text-center text-t-muted/60 text-xs space-x-2">
    <span>[N] New</span>
    <span>[E/Enter] Edit</span>
    <span>[D] Duplicate</span>
    <span>[X] Archive</span>
    <span>[W] Download</span>
    <span>[B] Back</span>
    <span class="mx-1">|</span>
    <span>[J/K] Navigate</span>
  </div>
</main>
