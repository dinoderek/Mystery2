import { describe, expect, it } from 'vitest';

import { readingAgeRows } from './profile-settings-view';
import { createProfileSettings } from '../../../../tests/testkit/src/fixtures';

describe('readingAgeRows', () => {
	it("marks the case's own age when the profile has set none", () => {
		const rows = readingAgeRows(createProfileSettings());

		expect(rows[0]).toEqual({ age: null, label: "EACH CASE'S OWN", selected: true });
		expect(rows.filter((row) => row.selected)).toHaveLength(1);
	});

	it('offers every age the narrator writes for, and marks the one set', () => {
		const rows = readingAgeRows(createProfileSettings({ reading_age: 9 }));

		expect(rows.map((row) => row.age)).toEqual([null, 6, 7, 8, 9, 10, 11]);
		expect(rows.filter((row) => row.selected).map((row) => row.label)).toEqual(['AGE 9']);
	});
});
