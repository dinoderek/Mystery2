// Wire shapes for `/api/ai-settings`, restated for the browser.
//
// Mirrors the Zod schemas in `packages/shared/src/mystery-api-contracts.ts`,
// which stay the source of truth. `web` deliberately does not depend on that
// package — it would pull Zod into the browser bundle for shapes the client
// never validates — so these are hand-kept in step, exactly as
// `./game.ts` is.
//
// Note what is absent: there is no field carrying an API key. A stored key
// never leaves the server, and the browser only ever sees `masked`.

export type AISettingsSource = 'env' | 'user';
export type AIMode = 'mock' | 'openrouter';

export interface AIKeySummary {
	label: string;
	source: AISettingsSource;
	/** Last four characters, for telling two keys apart. */
	masked: string;
}

export interface AIModelSummary {
	label: string;
	model_id: string;
	source: AISettingsSource;
}

/**
 * An AI configuration forced by the process this server was started with.
 * Present means the stored choice is not currently in effect.
 */
export interface AIOverride {
	provider: AIMode;
	model: string;
	source: string;
}

export interface AISettingsState {
	/** What the runtime will actually do, override and dangling selections applied. */
	effective_mode: AIMode;
	/** What was last chosen on the settings page. */
	stored_mode: AIMode;
	selected_key_label: string | null;
	selected_model_label: string | null;
	/** A selection naming a label the last environment reseed removed. */
	missing_key_label: string | null;
	missing_model_label: string | null;
	keys: AIKeySummary[];
	models: AIModelSummary[];
	override: AIOverride | null;
}
