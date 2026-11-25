// Wire shapes for `/api/ai-settings`, restated for the browser.
//
// Mirrors the Zod schemas in `packages/shared/src/mystery-api-contracts.ts`,
// which stay the source of truth. `web` deliberately does not depend on that
// package — it would pull Zod into the browser bundle for shapes the client
// never validates — so these are hand-kept in step, exactly as
// `./game.ts` is.
//
// No field carries a key: the page only chooses among the AIs in `ai.json`.

export type AIBackend = 'mock' | 'openrouter' | 'claude-cli';

export interface AISummary {
	name: string;
	backend: AIBackend;
	model: string;
}

export interface AIChoice extends AISummary {
	/** Null when the AI has what it needs; otherwise what is missing, naming it. */
	problem: string | null;
}

export interface AISettingsState {
	/** Mock first, then the file's AIs. */
	ais: AIChoice[];
	/** The name chosen on the page, or null when nothing has been chosen. */
	chosen: string | null;
	/** The AI ai.json names as its default, which narrates while nothing is chosen, or null. */
	configured_default: string | null;
	/** The AI the server was started with, which narrates instead of the choice. */
	override: AISummary | null;
	/** The AI that narrates a game started now. Null exactly when `narrator_error` is set. */
	narrator: AISummary | null;
	/** Why nothing can narrate: the choice or the default names an AI that is missing or broken. */
	narrator_error: string | null;
}
