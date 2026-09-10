<!--
	AI settings: which OpenRouter key and model to use, and whether narration
	runs mock or live.

	Reachable without a profile — it sits in front of the picker, and a machine
	with no working AI configuration is exactly the one that cannot get past it.
	No control here ever displays a stored key; the server sends only the last
	four characters.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { aiSettingsStore } from '$lib/domain/ai-settings-store.svelte';
	import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

	let newKeyLabel = $state('');
	let newKeyValue = $state('');
	let newModelLabel = $state('');
	let newModelId = $state('');

	const settings = $derived(aiSettingsStore.state);
	const busy = $derived(aiSettingsStore.saving);

	onMount(() => {
		aiSettingsStore.load();
	});

	function handleKeydown(event: KeyboardEvent) {
		// Ignore the shortcut while a field has focus, or typing "b" in the key
		// box would navigate away mid-entry.
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
		if (event.key === 'b' || event.key === 'B') goto('/login');
	}

	async function submitKey(event: Event) {
		event.preventDefault();
		if (await aiSettingsStore.addKey(newKeyLabel, newKeyValue)) {
			newKeyLabel = '';
			newKeyValue = '';
		}
	}

	async function submitModel(event: Event) {
		event.preventDefault();
		if (await aiSettingsStore.addModel(newModelLabel, newModelId)) {
			newModelLabel = '';
			newModelId = '';
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main
	class="bg-t-bg text-t-primary font-mono min-h-screen p-4 flex flex-col max-w-3xl mx-auto"
>
	<div class="mb-4">
		<h1 class="text-2xl font-bold mb-2 text-t-bright">AI SETTINGS</h1>
		<p class="text-t-muted/70 border-b border-t-muted/30 pb-4">
			Narration provider, keys and models. Stored on this machine.
		</p>
	</div>

	{#if aiSettingsStore.loading}
		<TerminalSpinner text="Loading settings..." />
	{:else if settings}
		{#if settings.override}
			<p
				class="text-t-warning border border-t-warning/40 p-3 mb-4 text-sm"
				data-testid="override-banner"
				role="status"
			>
				&gt; THIS SERVER WAS STARTED WITH AN AI OVERRIDE ({settings.override.source}):
				<strong>{settings.override.provider}</strong> / {settings.override.model}. The choices
				below are saved but will not take effect until it restarts without it.
			</p>
		{/if}

		{#if settings.missing_key_label}
			<p class="text-t-warning mb-4 text-sm" role="status">
				&gt; The selected key "{settings.missing_key_label}" is no longer configured. Narration
				has fallen back to mock.
			</p>
		{/if}
		{#if settings.missing_model_label}
			<p class="text-t-warning mb-4 text-sm" role="status">
				&gt; The selected model "{settings.missing_model_label}" is no longer configured.
				Narration has fallen back to mock.
			</p>
		{/if}

		{#if aiSettingsStore.error}
			<p class="text-t-error mb-4 text-sm" role="alert">{aiSettingsStore.error}</p>
		{/if}

		<div class="flex-1 space-y-8">
			<!-- Mode -->
			<section>
				<p class="text-t-muted text-sm mb-2">&gt; NARRATION</p>
				<div class="grid grid-cols-2 gap-2">
					{#each [{ value: 'mock', label: 'MOCK' }, { value: 'openrouter', label: 'REAL AI' }] as option (option.value)}
						<button
							type="button"
							data-testid="mode-{option.value}"
							disabled={busy}
							aria-pressed={settings.stored_mode === option.value}
							onclick={() => aiSettingsStore.setMode(option.value as 'mock' | 'openrouter')}
							class="border px-3 py-2 font-mono focus:outline-none disabled:opacity-50
								{settings.stored_mode === option.value
								? 'border-t-primary text-t-bright bg-t-primary/10'
								: 'border-t-muted/30 text-t-primary hover:border-t-primary'}"
						>
							[ {option.label} ]
						</button>
					{/each}
				</div>
				<p class="text-t-dim text-xs mt-2">
					In effect right now: <strong>{settings.effective_mode}</strong>. Real AI needs both a
					key and a model selected.
				</p>
			</section>

			<!-- Keys -->
			<section>
				<p class="text-t-muted text-sm mb-2">&gt; OPENROUTER KEY</p>
				{#if settings.keys.length === 0}
					<p class="text-t-dim text-sm mb-2">No keys yet. Add one below.</p>
				{:else}
					<ul class="space-y-2 mb-3">
						{#each settings.keys as key (key.label)}
							<li class="flex gap-2 items-stretch">
								<button
									type="button"
									data-testid="key-option"
									disabled={busy}
									aria-pressed={settings.selected_key_label === key.label}
									onclick={() =>
										aiSettingsStore.selectKey(
											settings.selected_key_label === key.label ? null : key.label
										)}
									class="flex-1 border px-3 py-2 text-left font-mono focus:outline-none
										disabled:opacity-50 {settings.selected_key_label === key.label
										? 'border-t-primary text-t-bright bg-t-primary/10'
										: 'border-t-muted/30 text-t-primary hover:border-t-primary'}"
								>
									{key.label}
									<span class="text-t-dim text-xs">{key.masked}</span>
									{#if key.source === 'env'}
										<span class="text-t-dim text-xs">[ENV]</span>
									{/if}
								</button>
								{#if key.source === 'user'}
									<button
										type="button"
										data-testid="delete-key"
										disabled={busy}
										aria-label="Delete key {key.label}"
										onclick={() => aiSettingsStore.deleteKey(key.label)}
										class="border border-t-muted/40 px-3 text-xs text-t-muted
											hover:border-t-error hover:text-t-error focus:outline-none disabled:opacity-50"
									>
										[ X ]
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<form onsubmit={submitKey} class="space-y-2">
					<div class="grid grid-cols-2 gap-2">
						<input
							type="text"
							bind:value={newKeyLabel}
							disabled={busy}
							maxlength="60"
							autocomplete="off"
							aria-label="New key label"
							placeholder="label"
							class="bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
								focus:border-t-primary focus:outline-none disabled:opacity-50"
						/>
						<input
							type="password"
							bind:value={newKeyValue}
							disabled={busy}
							autocomplete="off"
							aria-label="New key value"
							placeholder="sk-or-..."
							class="bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
								focus:border-t-primary focus:outline-none disabled:opacity-50"
						/>
					</div>
					<button
						type="submit"
						disabled={busy}
						class="w-full border border-t-primary px-3 py-2 font-mono text-t-bright
							hover:bg-t-primary/10 focus:outline-none disabled:opacity-50"
					>
						[ SAVE KEY ]
					</button>
				</form>
			</section>

			<!-- Models -->
			<section>
				<p class="text-t-muted text-sm mb-2">&gt; MODEL</p>
				{#if settings.models.length === 0}
					<p class="text-t-dim text-sm mb-2">No models yet. Add one below.</p>
				{:else}
					<ul class="space-y-2 mb-3">
						{#each settings.models as model (model.label)}
							<li class="flex gap-2 items-stretch">
								<button
									type="button"
									data-testid="model-option"
									disabled={busy}
									aria-pressed={settings.selected_model_label === model.label}
									onclick={() =>
										aiSettingsStore.selectModel(
											settings.selected_model_label === model.label ? null : model.label
										)}
									class="flex-1 border px-3 py-2 text-left font-mono focus:outline-none
										disabled:opacity-50 {settings.selected_model_label === model.label
										? 'border-t-primary text-t-bright bg-t-primary/10'
										: 'border-t-muted/30 text-t-primary hover:border-t-primary'}"
								>
									{model.label}
									<span class="text-t-dim text-xs">{model.model_id}</span>
									{#if model.source === 'env'}
										<span class="text-t-dim text-xs">[ENV]</span>
									{/if}
								</button>
								{#if model.source === 'user'}
									<button
										type="button"
										data-testid="delete-model"
										disabled={busy}
										aria-label="Delete model {model.label}"
										onclick={() => aiSettingsStore.deleteModel(model.label)}
										class="border border-t-muted/40 px-3 text-xs text-t-muted
											hover:border-t-error hover:text-t-error focus:outline-none disabled:opacity-50"
									>
										[ X ]
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<form onsubmit={submitModel} class="space-y-2">
					<div class="grid grid-cols-2 gap-2">
						<input
							type="text"
							bind:value={newModelLabel}
							disabled={busy}
							maxlength="60"
							autocomplete="off"
							aria-label="New model label"
							placeholder="label"
							class="bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
								focus:border-t-primary focus:outline-none disabled:opacity-50"
						/>
						<input
							type="text"
							bind:value={newModelId}
							disabled={busy}
							autocomplete="off"
							aria-label="New model ID"
							placeholder="anthropic/claude-sonnet-4"
							class="bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
								focus:border-t-primary focus:outline-none disabled:opacity-50"
						/>
					</div>
					<button
						type="submit"
						disabled={busy}
						class="w-full border border-t-primary px-3 py-2 font-mono text-t-bright
							hover:bg-t-primary/10 focus:outline-none disabled:opacity-50"
					>
						[ SAVE MODEL ]
					</button>
				</form>
			</section>
		</div>
	{:else}
		<p class="text-t-error text-sm" role="alert">
			{aiSettingsStore.error ?? 'Could not load settings.'}
		</p>
	{/if}

	<div class="mt-8 text-center">
		<button
			type="button"
			onclick={() => goto('/login')}
			class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted
				hover:border-t-primary hover:text-t-primary focus:outline-none"
		>
			[ BACK ]
		</button>
		<p class="text-t-dim text-xs mt-2">[ PRESS B TO GO BACK ]</p>
	</div>
</main>
