/** Align a runtime summary's columns for terminal output. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)));
  return [header, ...rows].map((row) =>
    row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd(),
  );
}
