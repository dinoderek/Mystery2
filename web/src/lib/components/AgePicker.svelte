<!--
	The reading ages to choose among, one button each. The ages and their labels
	come from `readingAgeRows`; the caller says what choosing one does. Used on
	the settings page, and where a game asks for an age the profile lacks.
-->
<script lang="ts">
	import { readingAgeRows } from '$lib/domain/profile-settings-view';

	let {
		selected = null,
		disabled = false,
		onchoose,
	}: { selected?: number | null; disabled?: boolean; onchoose: (age: number) => void } = $props();
</script>

<ul class="flex flex-wrap gap-2">
	{#each readingAgeRows(selected) as row (row.age)}
		<li>
			<button
				type="button"
				data-testid="reading-age-option"
				data-age={row.age}
				{disabled}
				aria-pressed={row.selected}
				onclick={() => onchoose(row.age)}
				class="min-h-11 border px-3 py-2 text-left font-mono focus:outline-none
					disabled:opacity-50 {row.selected
					? 'border-t-primary text-t-bright bg-t-primary/10'
					: 'border-t-muted/30 text-t-primary hover:border-t-primary'}"
			>
				[ {row.label} ]
			</button>
		</li>
	{/each}
</ul>
