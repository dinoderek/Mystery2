// What the settings page and the profile picker say about the AIs, as plain
// functions of the settings state, so the web unit suite covers it.

import type { AIChoice, AISettingsState, AISummary } from '$lib/types/ai-settings';

export interface AIRow {
	name: string;
	/** Backend and model, never a key: the state carries none. */
	detail: string;
	/** Marked on the page. Mock is marked while nothing has been chosen, because it narrates then. */
	selected: boolean;
	/** Why it cannot be chosen, or null. */
	problem: string | null;
}

function detail(ai: AISummary): string {
	return ai.backend === 'mock' ? 'built in, no real AI' : `${ai.backend} / ${ai.model}`;
}

/** The name the page marks. */
export function selectedName(state: AISettingsState): string {
	return state.chosen ?? 'mock';
}

/** One row per AI, mock first. */
export function aiRows(state: AISettingsState): AIRow[] {
	const selected = selectedName(state);
	return state.ais.map((ai: AIChoice) => ({
		name: ai.name,
		detail: detail(ai),
		selected: ai.name === selected,
		problem: ai.problem
	}));
}

export interface NarratorLine {
	text: string;
	/** True when nothing can narrate: no game starts until the choice is fixed. */
	error: boolean;
}

/** The line that names the AI narrating a game started now. */
export function narratorLine(state: AISettingsState): NarratorLine {
	if (state.narrator) {
		return { text: `NARRATOR: ${state.narrator.name} (${detail(state.narrator)})`, error: false };
	}
	return { text: `NO NARRATOR: ${state.narrator_error ?? 'unknown error'}`, error: true };
}

/** The banner shown while a run override narrates instead of the choice, or null. */
export function overrideBanner(state: AISettingsState): string | null {
	if (!state.override) return null;
	return (
		`THIS SERVER WAS STARTED WITH --ai ${state.override.name} (${detail(state.override)}). ` +
		'It narrates every game until the server restarts without it; the choice below waits until then.'
	);
}
