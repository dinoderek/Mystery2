// What the settings page and the age pickers show of a reading age, as plain
// functions of the chosen age, so the web unit suite covers it.

import { READING_AGES } from '@my2/shared';

export interface ReadingAgeRow {
	age: number;
	label: string;
	selected: boolean;
}

/** Every age the narrator can write for, youngest first; `chosen` is null until one is picked. */
export function readingAgeRows(chosen: number | null): ReadingAgeRow[] {
	return READING_AGES.map((age) => ({ age, label: `AGE ${age}`, selected: chosen === age }));
}
