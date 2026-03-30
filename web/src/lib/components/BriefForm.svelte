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
  let artStyle = $state(init?.art_style ?? '');
  let mustIncludeText = $state(init?.must_include ? init.must_include.join('\n') : '');
  let culprits = $state<number | null>(init?.culprits ?? null);
  let suspects = $state<number | null>(init?.suspects ?? null);
  let witnesses = $state<number | null>(init?.witnesses ?? null);
  let locations = $state<number | null>(init?.locations ?? null);
  let redHerringTrails = $state<number | null>(init?.red_herring_trails ?? null);
  let coverUps = $state<boolean | null>(init?.cover_ups ?? null);
  let eliminationComplexity = $state<string>(init?.elimination_complexity ?? '');

  let errors = $state<Record<string, string>>({});
  let dirty = $state(false);
  let showExitConfirm = $state(false);
  let focusedField = $state<string | null>(null);

  const isSaving = $derived(briefStore.status === 'saving');
  const isEdit = !!init?.id;

  /** Descriptions shown in the bottom helper row keyed by field name. */
  const fieldDescriptions: Record<string, string> = {
    brief: 'The core mystery premise that drives the entire story. Be vivid and specific — this is what the AI builds the blueprint around.',
    targetAge: 'The intended player age (6-11). Influences vocabulary, puzzle complexity, and theme intensity.',
    timeBudget: 'Maximum number of turns the player has to solve the mystery. Lower = tighter pacing.',
    locations: 'How many distinct places the player can visit. More locations means a larger world to explore.',
    culprits: 'Number of guilty characters. Usually 1; use 2 for conspiracy-style mysteries.',
    suspects: 'Number of innocent characters who look guilty. More suspects = harder elimination.',
    witnesses: 'Characters who know something useful but are not suspects. They give flavour and clues.',
    redHerringTrails: 'False leads woven into the story. More trails = more misdirection for the player.',
    coverUps: 'Whether suspects have false alibis or cover stories that the player must see through.',
    eliminationComplexity: 'How hard it is to rule out a suspect. Simple = one clue. Moderate = cross-reference 2+ clues. Complex = multi-step reasoning.',
    artStyle: 'Visual direction for generated artwork (e.g. "watercolor noir", "pixel art detective").',
    titleHint: 'Suggested mystery title. The generator may use it as-is or draw inspiration from it.',
    mustInclude: 'Required story ingredients — characters, objects, themes, or constraints the blueprint must contain. One item per line.',
  };

  const fieldDescription = $derived(
    focusedField && fieldDescriptions[focusedField]
      ? fieldDescriptions[focusedField]
      : 'Select a field to see its description.'
  );

  // Track dirty state on any field change
  function markDirty() {
    dirty = true;
  }

  function validate(): boolean {
    const e: Record<string, string> = {};

    if (!brief.trim()) {
      e.brief = 'Mystery premise is required';
    }

    if (targetAge == null || targetAge < 6 || targetAge > 11 || !Number.isInteger(targetAge)) {
      e.targetAge = 'Target age must be between 6 and 11';
    }

    if (timeBudget != null && (timeBudget < 1 || timeBudget > 100 || !Number.isInteger(timeBudget))) {
      e.timeBudget = 'Time budget must be between 1 and 100';
    }

    if (culprits != null && (culprits < 1 || culprits > 2 || !Number.isInteger(culprits))) {
      e.culprits = 'Culprits must be 1 or 2';
    }

    if (suspects != null && (suspects < 1 || suspects > 6 || !Number.isInteger(suspects))) {
      e.suspects = 'Suspects must be between 1 and 6';
    }

    if (witnesses != null && (witnesses < 1 || witnesses > 6 || !Number.isInteger(witnesses))) {
      e.witnesses = 'Witnesses must be between 1 and 6';
    }

    if (locations != null && (locations < 1 || locations > 10 || !Number.isInteger(locations))) {
      e.locations = 'Locations must be between 1 and 10';
    }

    if (redHerringTrails != null && (redHerringTrails < 1 || redHerringTrails > 10 || !Number.isInteger(redHerringTrails))) {
      e.redHerringTrails = 'Red herring trails must be between 1 and 10';
    }

    errors = e;
    return Object.keys(e).length === 0;
  }

  /** Parse the must-include textarea into a clean string array. */
  function parseMustInclude(): string[] {
    return mustIncludeText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      brief: brief.trim(),
      target_age: targetAge,
      time_budget: timeBudget,
      title_hint: titleHint.trim() || null,
      art_style: artStyle.trim() || null,
      must_include: parseMustInclude(),
      culprits,
      suspects,
      locations,
      witnesses,
      red_herring_trails: redHerringTrails,
      cover_ups: coverUps,
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
      art_style: artStyle.trim() || null,
      must_include: parseMustInclude(),
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

  /** Generate integer range [min, max] as option values. */
  function range(min: number, max: number): number[] {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
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

  // Shared input classes for reuse
  const selectCls = 'w-24 bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none';
  const inputSmallCls = 'w-24 bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none';
  const inputFullCls = 'w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 focus:border-t-primary focus:outline-none';
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

    <!-- Premise (full-width multiline) -->
    <div>
      <label for="brief-text" class="block text-t-bright text-sm mb-1">Mystery Premise *</label>
      <textarea
        id="brief-text"
        data-testid="brief-field"
        class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 min-h-24 focus:border-t-primary focus:outline-none"
        bind:value={brief}
        oninput={markDirty}
        onfocus={() => focusedField = 'brief'}
        placeholder="Describe the mystery premise..."
      ></textarea>
      {#if errors.brief}<p class="text-t-error text-xs mt-1" data-testid="error-brief">{errors.brief}</p>{/if}
    </div>

    <!-- Row: Target Age + Time Budget -->
    <div class="flex gap-6">
      <div>
        <label for="target-age" class="block text-t-bright text-sm mb-1">Target Age *</label>
        <select
          id="target-age"
          data-testid="target-age-field"
          class={selectCls}
          value={targetAge ?? ''}
          onchange={(e) => { targetAge = (e.target as HTMLSelectElement).value === '' ? null : parseInt((e.target as HTMLSelectElement).value, 10); markDirty(); }}
          onfocus={() => focusedField = 'targetAge'}
        >
          <option value="">—</option>
          {#each range(6, 11) as age}
            <option value={age}>{age}</option>
          {/each}
        </select>
        {#if errors.targetAge}<p class="text-t-error text-xs mt-1" data-testid="error-targetAge">{errors.targetAge}</p>{/if}
      </div>

      <div>
        <label for="time-budget" class="block text-t-bright text-sm mb-1">Time Budget</label>
        <input
          id="time-budget"
          data-testid="time-budget-field"
          type="number"
          min="1"
          max="100"
          class={inputSmallCls}
          value={timeBudget ?? ''}
          oninput={(e) => { timeBudget = (e.target as HTMLInputElement).value === '' ? null : parseInt((e.target as HTMLInputElement).value, 10); markDirty(); }}
          onfocus={() => focusedField = 'timeBudget'}
          placeholder="turns"
        />
        {#if errors.timeBudget}<p class="text-t-error text-xs mt-1">{errors.timeBudget}</p>{/if}
      </div>
    </div>

    <!-- Section: Mystery Size -->
    <fieldset>
      <legend class="text-t-bright text-lg font-bold border-b border-t-muted/30 pb-2 mb-4 w-full">
        Mystery Size
      </legend>

      <div class="flex flex-wrap gap-6">
        <div>
          <label for="locations" class="block text-t-bright text-sm mb-1">Locations</label>
          <select
            id="locations"
            data-testid="locations-field"
            class={selectCls}
            value={locations ?? ''}
            onchange={(e) => { locations = (e.target as HTMLSelectElement).value === '' ? null : parseInt((e.target as HTMLSelectElement).value, 10); markDirty(); }}
            onfocus={() => focusedField = 'locations'}
          >
            <option value="">—</option>
            {#each range(1, 10) as n}
              <option value={n}>{n}</option>
            {/each}
          </select>
          {#if errors.locations}<p class="text-t-error text-xs mt-1">{errors.locations}</p>{/if}
        </div>

        <div>
          <label for="culprits" class="block text-t-bright text-sm mb-1">Culprits</label>
          <select
            id="culprits"
            data-testid="culprits-field"
            class={selectCls}
            value={culprits ?? ''}
            onchange={(e) => { culprits = (e.target as HTMLSelectElement).value === '' ? null : parseInt((e.target as HTMLSelectElement).value, 10); markDirty(); }}
            onfocus={() => focusedField = 'culprits'}
          >
            <option value="">—</option>
            {#each range(1, 2) as n}
              <option value={n}>{n}</option>
            {/each}
          </select>
          {#if errors.culprits}<p class="text-t-error text-xs mt-1">{errors.culprits}</p>{/if}
        </div>

        <div>
          <label for="suspects" class="block text-t-bright text-sm mb-1">Suspects</label>
          <select
            id="suspects"
            data-testid="suspects-field"
            class={selectCls}
            value={suspects ?? ''}
            onchange={(e) => { suspects = (e.target as HTMLSelectElement).value === '' ? null : parseInt((e.target as HTMLSelectElement).value, 10); markDirty(); }}
            onfocus={() => focusedField = 'suspects'}
          >
            <option value="">—</option>
            {#each range(1, 6) as n}
              <option value={n}>{n}</option>
            {/each}
          </select>
          {#if errors.suspects}<p class="text-t-error text-xs mt-1">{errors.suspects}</p>{/if}
        </div>

        <div>
          <label for="witnesses" class="block text-t-bright text-sm mb-1">Witnesses</label>
          <select
            id="witnesses"
            data-testid="witnesses-field"
            class={selectCls}
            value={witnesses ?? ''}
            onchange={(e) => { witnesses = (e.target as HTMLSelectElement).value === '' ? null : parseInt((e.target as HTMLSelectElement).value, 10); markDirty(); }}
            onfocus={() => focusedField = 'witnesses'}
          >
            <option value="">—</option>
            {#each range(1, 6) as n}
              <option value={n}>{n}</option>
            {/each}
          </select>
          {#if errors.witnesses}<p class="text-t-error text-xs mt-1">{errors.witnesses}</p>{/if}
        </div>
      </div>
    </fieldset>

    <!-- Section: Complexities -->
    <fieldset>
      <legend class="text-t-bright text-lg font-bold border-b border-t-muted/30 pb-2 mb-4 w-full">
        Complexities
      </legend>

      <div class="flex flex-wrap gap-6">
        <div>
          <label for="red-herrings" class="block text-t-bright text-sm mb-1">Red Herring Trails</label>
          <select
            id="red-herrings"
            data-testid="red-herrings-field"
            class={selectCls}
            value={redHerringTrails ?? ''}
            onchange={(e) => { redHerringTrails = (e.target as HTMLSelectElement).value === '' ? null : parseInt((e.target as HTMLSelectElement).value, 10); markDirty(); }}
            onfocus={() => focusedField = 'redHerringTrails'}
          >
            <option value="">—</option>
            {#each range(1, 10) as n}
              <option value={n}>{n}</option>
            {/each}
          </select>
          {#if errors.redHerringTrails}<p class="text-t-error text-xs mt-1">{errors.redHerringTrails}</p>{/if}
        </div>

        <div>
          <label for="cover-ups" class="block text-t-bright text-sm mb-1">Cover Ups</label>
          <select
            id="cover-ups"
            data-testid="cover-ups-field"
            class={selectCls}
            value={coverUps == null ? '' : coverUps ? 'yes' : 'no'}
            onchange={(e) => { const v = (e.target as HTMLSelectElement).value; coverUps = v === '' ? null : v === 'yes'; markDirty(); }}
            onfocus={() => focusedField = 'coverUps'}
          >
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        <div>
          <label for="elimination" class="block text-t-bright text-sm mb-1">Elimination Complexity</label>
          <select
            id="elimination"
            data-testid="elimination-field"
            class={selectCls}
            bind:value={eliminationComplexity}
            onchange={markDirty}
            onfocus={() => focusedField = 'eliminationComplexity'}
          >
            <option value="">—</option>
            <option value="simple">Simple</option>
            <option value="moderate">Moderate</option>
            <option value="complex">Complex</option>
          </select>
        </div>
      </div>
    </fieldset>

    <!-- Section: Flavor -->
    <fieldset>
      <legend class="text-t-bright text-lg font-bold border-b border-t-muted/30 pb-2 mb-4 w-full">
        Flavor
      </legend>

      <div class="space-y-4">
        <div>
          <label for="art-style" class="block text-t-bright text-sm mb-1">Art Style</label>
          <input
            id="art-style"
            data-testid="art-style-field"
            type="text"
            class={inputFullCls}
            bind:value={artStyle}
            oninput={markDirty}
            onfocus={() => focusedField = 'artStyle'}
            placeholder="Visual direction (e.g., 'watercolor noir')"
          />
        </div>

        <div>
          <label for="title-hint" class="block text-t-bright text-sm mb-1">Title Hint</label>
          <input
            id="title-hint"
            data-testid="title-hint-field"
            type="text"
            class={inputFullCls}
            bind:value={titleHint}
            oninput={markDirty}
            onfocus={() => focusedField = 'titleHint'}
            placeholder="Suggested mystery title"
          />
        </div>
      </div>
    </fieldset>

    <!-- Section: Must Include -->
    <fieldset>
      <legend class="text-t-bright text-lg font-bold border-b border-t-muted/30 pb-2 mb-4 w-full">
        Must Include
      </legend>

      <div>
        <textarea
          id="must-include-input"
          data-testid="must-include-field"
          class="w-full bg-t-bg border border-t-muted/30 text-t-primary font-mono p-2 min-h-24 focus:border-t-primary focus:outline-none"
          bind:value={mustIncludeText}
          oninput={markDirty}
          onfocus={() => focusedField = 'mustInclude'}
          placeholder="One item per line&#10;e.g.&#10;hidden passage&#10;old diary&#10;a talking parrot"
        ></textarea>
      </div>
    </fieldset>

    <!-- Save error -->
    {#if briefStore.error}
      <p class="text-t-error text-sm" data-testid="save-error">{briefStore.error}</p>
    {/if}
  </div>

  <!-- Field description helper -->
  <div class="mt-2 px-2 py-1 text-t-muted/70 text-xs border border-t-muted/20 min-h-[1.75rem]">
    {fieldDescription}
  </div>

  <!-- Footer with actions -->
  <div class="mt-2 flex items-center justify-between">
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
