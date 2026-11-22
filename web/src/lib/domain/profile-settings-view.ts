// What the settings page shows of a profile's reading age, as plain functions
// of its state, so the web unit suite covers it.

import { READING_AGES, type ProfileSettings } from '@my2/shared';

export interface ReadingAgeRow {
	/** The age the button sets; null clears it, so each case reads at its own. */
	age: number | null;
	label: string;
	selected: boolean;
}

/** The case's own age first, then every age the narrator can write for. */
export function readingAgeRows(state: ProfileSettings): ReadingAgeRow[] {
	return [
		{ age: null, label: "EACH CASE'S OWN", selected: state.reading_age === null },
		...READING_AGES.map((age) => ({
			age,
			label: `AGE ${age}`,
			selected: state.reading_age === age,
		})),
	];
}
