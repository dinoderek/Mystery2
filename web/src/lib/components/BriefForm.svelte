<script lang="ts">
  import { goto } from '$app/navigation';
  import { briefStore } from '$lib/domain/brief-store.svelte';
  import type { BriefFull } from '$lib/types/brief';

  interface Props {
    initialData?: BriefFull;
  }

  const { initialData }: Props = $props();

  // Snapshot initial prop values to initialize form state (intentional one-time read).
  // svelte-ignore state_referenced_locally
  const init = initialData;

  // Form state
  let brief = $state(init?.brief ?? '');
  let targetAge = $state<number | null>(init?.target_age ?? null);
  let timeBudget = $state<number | null>(init?.time_budget ?? null);
  let titleHint = $state(init?.title_hint ?? '');
  let oneLinerHint = $state(init?.one_liner_hint ?? '');
  let artStyle = $state(init?.art_style ?? '');
  let mustInclude = $state<string[]>(init?.must_include ? [...init.must_include] : []);
  let culprits = $state<number | null>(init?.culprits ?? null);
  let suspects = $state<number | null>(init?.suspects ?? null);
  let witnesses = $state<number | null>(init?.witnesses ?? null);
  let locations = $state<number | null>(init?.locations ?? null);
  let redHerringTrails = $state<number | null>(init?.red_herring_trails ?? null);
  let coverUps = $state<boolean>(init?.cover_ups ?? false);
  let eliminationComplexity = $state<string>(init?.elimination_complexity ?? '');

  let tagInput = $state('');
  let errors = $state<Record<string, string>>({});
  let dirty = $state(false);
  let showExitConfirm = $state(false);

  const isSaving = $derived(briefStore.status === 'saving');
  const isEdit = !!init?.id;

  // Track dirty state on any field change
  function markDirty() {
    dirty = true;
  }

  function validate(): boolean {
    const e: Record<string, string> = {};

    if (!brief.trim()) {
      e.brief = 'Mystery premise is required';
    }

    if (targetAge == null || targetAge < 1 || !Number.isInteger(targetAge)) {
      e.targetAge = 'Target age must be a positive integer';
    }

    if (timeBudget != null && (timeBudget < 1 || !Number.isInteger(timeBudget))) {
      e.timeBudget = 'Time budget must be a positive integer';
    }

    if (culprits != null && (culprits < 1 || !Number.isInteger(culprits))) {
      e.culprits = 'Culprits must be a positive integer';
    }

    if (suspects != null && (suspects < 0 || !Number.isInteger(suspects))) {
      e.suspects = 'Suspects must be a non-negative integer';
    }

    if (witnesses != null && (witnesses < 0 || !Number.isInteger(witnesses))) {
      e.witnesses = 'Witnesses must be a non-negative integer';
    }

    if (locations != null && (locations < 1 || !Number.isInteger(locations))) {
      e.locations = 'Locations must be a positive integer';
    }

    if (redHerringTrails != null && (redHerringTrails < 0 || !Number.isInteger(redHerringTrails))) {
      e.redHerringTrails = 'Red herring trails must be a non-negative integer';
    }

    errors = e;
    return Object.keys(e).length === 0;
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      brief: brief.trim(),
      target_age: targetAge,
      time_budget: timeBudget,
      title_hint: titleHint.trim() || null,
      one_liner_hint: oneLinerHint.trim() || null,
      art_style: artStyle.trim() || null,
      must_include: mustInclude,
      culprits,
      suspects,
      locations,
      witnesses,
      red_herring_trails: redHerringTrails,
      cover_ups: coverUps || null,
      elimination_complexity: eliminationComplexity || null,
    };

    if (init?.id) {
      payload.id = init.id;
    }

    return payload;
  }

  async function handleSave() {
    if (!validate()) return;

    const saved = await briefStore.saveBrief(buildPayload());
    if (saved) {
      dirty = false;
      await goto('/briefs');
    }
  }

  function handleDownload() {
    if (!validate()) return;

    // Build a temporary BriefFull for export
    const tempBrief: BriefFull = {
      id: init?.id ?? '',
      brief: brief.trim(),
      target_age: targetAge!,
      time_budget: timeBudget,
      title_hint: titleHint.trim() || null,
      one_liner_hint: oneLinerHint.trim() || null,
      art_style: artStyle.trim() || null,
      must_include: mustInclude,
      culprits,
      suspects,
      witnesses,
      locations,
      red_herring_trails: redHerringTrails,
      cover_ups: coverUps || null,
      elimination_complexity: (eliminationComplexity || null) as BriefFull['elimination_complexity'],
      archived_at: null,
      created_at: init?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    briefStore.downloadAsJson(tempBrief);
  }

  async function handleBack() {
    if (dirty) {
      showExitConfirm = true;
      return;
    }
    briefStore.clearActive();
    await goto('/briefs');
  }

  async function confirmExit() {
    showExitConfirm = false;
    dirty = false;
    briefStore.clearActive();
    await goto('/briefs');
  }

  function addTag() {
    const tag = tagInput.trim();
    if (tag && !mustInclude.includes(tag)) {
      mustInclude = [...mustInclude, tag];
      markDirty();
    }
    tagInput = '';
  }

  function removeTag(index: number) {
    mustInclude = mustInclude.filter((_, i) => i !== index);
    markDirty();
  }

  function handleTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTag();
    } else if (event.key === 'Backspace' && tagInput === '' && mustInclude.length > 0) {
      removeTag(mustInclude.length - 1);
    }
  }

  function parseNumberInput(value: string): number | null {
    if (value === '') return null;
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (showExitConfirm) {
      if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
        event.preventDefault();
        await confirmExit();
        return;
      }
      if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
        event.preventDefault();
        showExitConfirm = false;
        return;
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      await handleBack();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      await handleSave();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault();
      handleDownload();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="bg-t-bg text-t-primary font-mono p-4 flex flex-col h-screen max-w-6xl mx-auto">
  <!-- Header -->
  <div class="mb-4">
    <h1 class="text-2xl font-bold mb-2">{isEdit ? 'EDIT BRIEF' : 'NEW BRIEF'}</h1>
    <p class="text-t-muted/70 border-b border-t-muted/30 pb-4">
      {isEdit ? 'Modify your story brief.' : 'Create a new mystery story brief.'}
      {#if dirty}<span class="text-t-warning ml-2">[unsaved changes]</span>{/if}
    </p>
  </div>

  <!-- Exit confirmation -->
  {#if showExitConfirm}
    <div class="mb-4 border border-t-warning/60 p-3 text-t-warning" data-testid="exit-confirm">
      You have unsaved changes. Discard and leave? Press <span class="font-bold">y</span> to confirm or <span class="font-bold">n</span> to cancel.
    </div>
  {/if}

  <!-- Scrollable form -->
  <div class="flex-1 min-h-0 overflow-y-auto border border-t-muted/30 p-4 space-y-6">

    <!-- Section 1: Creative Direction -->
    <fieldset>
      <legend class="text-t-bright text-lg font-bold border-b border-t-muted/30 pb-2 mb-4 w-full">
        Creative Direction
      </legend>

      <div class="space-y-4">
        <!-- brief (required) -->
        <div>
          <label for="brief-text" class="block text-t-bright text-sm mb-1">Mystery Premise *</label>
          <textarea
            id="brief-text"
            data-testid="brief-field"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 min-h-24 focus:border-t-primary focus:outline-none"
            bind:value={brief}
            oninput={markDirty}
            placeholder="Describe the mystery premise..."
          ></textarea>
          {#if errors.brief}<p class="text-t-error text-xs mt-1" data-testid="error-brief">{errors.brief}</p>{/if}
        </div>

        <!-- targetAge (required) -->
        <div>
          <label for="target-age" class="block text-t-bright text-sm mb-1">Target Age *</label>
          <input
            id="target-age"
            data-testid="target-age-field"
            type="number"
            min="1"
            class="w-24 bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            value={targetAge ?? ''}
            oninput={(e) => { targetAge = parseNumberInput((e.target as HTMLInputElement).value); markDirty(); }}
          />
          {#if errors.targetAge}<p class="text-t-error text-xs mt-1" data-testid="error-targetAge">{errors.targetAge}</p>{/if}
        </div>

        <!-- titleHint -->
        <div>
          <label for="title-hint" class="block text-t-bright text-sm mb-1">Title Hint</label>
          <input
            id="title-hint"
            data-testid="title-hint-field"
            type="text"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            bind:value={titleHint}
            oninput={markDirty}
            placeholder="Suggested mystery title"
          />
        </div>

        <!-- oneLinerHint -->
        <div>
          <label for="one-liner" class="block text-t-bright text-sm mb-1">One-Liner Summary</label>
          <input
            id="one-liner"
            data-testid="one-liner-field"
            type="text"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            bind:value={oneLinerHint}
            oninput={markDirty}
            placeholder="Short player-facing summary"
          />
        </div>

        <!-- artStyle -->
        <div>
          <label for="art-style" class="block text-t-bright text-sm mb-1">Art Style</label>
          <input
            id="art-style"
            data-testid="art-style-field"
            type="text"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            bind:value={artStyle}
            oninput={markDirty}
            placeholder="Visual direction (e.g., 'watercolor noir')"
          />
        </div>

        <!-- mustInclude (tag input) -->
        <div>
          <label for="must-include-input" class="block text-t-bright text-sm mb-1">Must Include</label>
          <div class="flex flex-wrap gap-2 mb-2">
            {#each mustInclude as tag, i}
              <span class="inline-flex items-center gap-1 border border-t-muted/40 px-2 py-0.5 text-sm text-t-muted">
                {tag}
                <button
                  type="button"
                  class="text-t-error hover:text-t-bright text-xs"
                  onclick={() => removeTag(i)}
                  aria-label="Remove {tag}"
                >x</button>
              </span>
            {/each}
          </div>
          <input
            id="must-include-input"
            data-testid="must-include-field"
            type="text"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            bind:value={tagInput}
            onkeydown={handleTagKeydown}
            placeholder="Type and press Enter to add"
          />
        </div>
      </div>
    </fieldset>

    <!-- Section 2: Structural Parameters -->
    <fieldset>
      <legend class="text-t-bright text-lg font-bold border-b border-t-muted/30 pb-2 mb-4 w-full">
        Structural Parameters
      </legend>

      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label for="time-budget" class="block text-t-bright text-sm mb-1">Time Budget</label>
          <input
            id="time-budget"
            data-testid="time-budget-field"
            type="number"
            min="1"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            value={timeBudget ?? ''}
            oninput={(e) => { timeBudget = parseNumberInput((e.target as HTMLInputElement).value); markDirty(); }}
            placeholder="turns"
          />
          {#if errors.timeBudget}<p class="text-t-error text-xs mt-1">{errors.timeBudget}</p>{/if}
        </div>

        <div>
          <label for="culprits" class="block text-t-bright text-sm mb-1">Culprits</label>
          <input
            id="culprits"
            data-testid="culprits-field"
            type="number"
            min="1"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            value={culprits ?? ''}
            oninput={(e) => { culprits = parseNumberInput((e.target as HTMLInputElement).value); markDirty(); }}
            placeholder="1"
          />
          {#if errors.culprits}<p class="text-t-error text-xs mt-1">{errors.culprits}</p>{/if}
        </div>

        <div>
          <label for="suspects" class="block text-t-bright text-sm mb-1">Suspects</label>
          <input
            id="suspects"
            data-testid="suspects-field"
            type="number"
            min="0"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            value={suspects ?? ''}
            oninput={(e) => { suspects = parseNumberInput((e.target as HTMLInputElement).value); markDirty(); }}
          />
          {#if errors.suspects}<p class="text-t-error text-xs mt-1">{errors.suspects}</p>{/if}
        </div>

        <div>
          <label for="witnesses" class="block text-t-bright text-sm mb-1">Witnesses</label>
          <input
            id="witnesses"
            data-testid="witnesses-field"
            type="number"
            min="0"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            value={witnesses ?? ''}
            oninput={(e) => { witnesses = parseNumberInput((e.target as HTMLInputElement).value); markDirty(); }}
          />
          {#if errors.witnesses}<p class="text-t-error text-xs mt-1">{errors.witnesses}</p>{/if}
        </div>

        <div>
          <label for="locations" class="block text-t-bright text-sm mb-1">Locations</label>
          <input
            id="locations"
            data-testid="locations-field"
            type="number"
            min="1"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            value={locations ?? ''}
            oninput={(e) => { locations = parseNumberInput((e.target as HTMLInputElement).value); markDirty(); }}
          />
          {#if errors.locations}<p class="text-t-error text-xs mt-1">{errors.locations}</p>{/if}
        </div>

        <div>
          <label for="red-herrings" class="block text-t-bright text-sm mb-1">Red Herring Trails</label>
          <input
            id="red-herrings"
            data-testid="red-herrings-field"
            type="number"
            min="0"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            value={redHerringTrails ?? ''}
            oninput={(e) => { redHerringTrails = parseNumberInput((e.target as HTMLInputElement).value); markDirty(); }}
          />
          {#if errors.redHerringTrails}<p class="text-t-error text-xs mt-1">{errors.redHerringTrails}</p>{/if}
        </div>

        <div class="flex items-center gap-2">
          <input
            id="cover-ups"
            data-testid="cover-ups-field"
            type="checkbox"
            class="accent-[var(--t-primary)]"
            bind:checked={coverUps}
            onchange={markDirty}
          />
          <label for="cover-ups" class="text-t-bright text-sm">Cover Ups</label>
        </div>

        <div>
          <label for="elimination" class="block text-t-bright text-sm mb-1">Elimination Complexity</label>
          <select
            id="elimination"
            data-testid="elimination-field"
            class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none"
            bind:value={eliminationComplexity}
            onchange={markDirty}
          >
            <option value="">—</option>
            <option value="simple">Simple</option>
            <option value="moderate">Moderate</option>
            <option value="complex">Complex</option>
          </select>
        </div>
      </div>
    </fieldset>

    <!-- Save error -->
    {#if briefStore.error}
      <p class="text-t-error text-sm" data-testid="save-error">{briefStore.error}</p>
    {/if}
  </div>

  <!-- Footer with actions -->
  <div class="mt-4 flex items-center justify-between">
    <div class="text-t-muted/60 text-xs space-x-2">
      <span>[Ctrl+S] Save</span>
      <span>[Ctrl+Shift+D] Download</span>
      <span>[Esc] Back</span>
      <span>[Tab] Next field</span>
    </div>
    <div class="flex gap-2">
      <button
        type="button"
        class="border border-t-muted/40 px-4 py-1 text-sm text-t-muted hover:border-t-primary hover:text-t-primary"
        onclick={handleBack}
      >
        CANCEL
      </button>
      <button
        type="button"
        data-testid="save-button"
        class="border border-t-primary px-4 py-1 text-sm text-t-primary hover:bg-t-primary/10 disabled:opacity-40"
        disabled={isSaving}
        onclick={handleSave}
      >
        {isSaving ? 'SAVING...' : 'SAVE'}
      </button>
    </div>
  </div>
</main>
