import { describe, expect, it } from 'vitest';

import { readingAgeRows } from './profile-settings-view';

describe('readingAgeRows', () => {
	it('offers every age the narrator writes for, and marks the one chosen', () => {
		const rows = readingAgeRows(9);

		expect(rows.map((row) => row.age)).toEqual([6, 7, 8, 9, 10, 11]);
		expect(rows.filter((row) => row.selected).map((row) => row.label)).toEqual(['AGE 9']);
	});

	it('has no "each case\'s own" row, and marks nothing before an age is chosen', () => {
		const rows = readingAgeRows(null);

		expect(rows.map((row) => row.label)).toEqual(['AGE 6', 'AGE 7', 'AGE 8', 'AGE 9', 'AGE 10', 'AGE 11']);
		expect(rows.some((row) => row.selected)).toBe(false);
	});
});
