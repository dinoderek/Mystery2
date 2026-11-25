/**
 * One inline SVG line chart for `perf report`'s page: runs along the x axis in
 * start order, one value per run on the y axis, one line per series, and a
 * dashed mark where a step starts. A run with no value leaves a gap. Nothing is
 * fetched; colours are CSS classes (`s0` to `s7`) the page defines, so the chart
 * follows the page's light and dark themes.
 */

export interface ChartSeries {
  name: string;
  /** One value per run, null where the run has none. */
  values: ReadonlyArray<number | null>;
}

export interface ChartMark {
  /** The run a step starts at. */
  index: number;
  label: string;
}

export interface ChartSpec {
  title: string;
  series: readonly ChartSeries[];
  /** The text of each run, for its point's tooltip. */
  runs: readonly string[];
  marks: readonly ChartMark[];
  format: (value: number) => string;
  /** A fixed y range, else from zero to the largest value. */
  max?: number;
}

export const SERIES_CLASSES = 8;

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { left: 64, right: 16, top: 16, bottom: 28 };

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function top(max: number): number {
  if (max <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / unit) * unit;
}

/** The chart, or null when no series has a value to draw. */
export function renderChart(spec: ChartSpec): string | null {
  const values = spec.series.flatMap((series) => series.values).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  const max = spec.max ?? top(Math.max(...values));
  const runs = spec.runs.length;
  const x = (index: number) => PAD.left + (runs <= 1 ? (WIDTH - PAD.left - PAD.right) / 2 : (index / (runs - 1)) * (WIDTH - PAD.left - PAD.right));
  const y = (value: number) => PAD.top + (1 - value / max) * (HEIGHT - PAD.top - PAD.bottom);

  const parts: string[] = [];
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (max * tick) / 4;
    parts.push(`<line class="grid" x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`);
    parts.push(`<text class="tick" x="${PAD.left - 6}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(spec.format(value))}</text>`);
  }
  for (const mark of spec.marks) {
    parts.push(`<line class="mark" x1="${x(mark.index).toFixed(1)}" x2="${x(mark.index).toFixed(1)}" y1="${PAD.top}" y2="${HEIGHT - PAD.bottom}"/>`);
    const right = x(mark.index) > WIDTH / 2;
    parts.push(
      `<text class="tick" x="${(x(mark.index) + (right ? -3 : 3)).toFixed(1)}" y="${PAD.top + 10}"${right ? ' text-anchor="end"' : ""}>${escapeHtml(mark.label)}</text>`,
    );
  }
  parts.push(`<text class="tick" x="${PAD.left}" y="${HEIGHT - 8}">run 1</text>`);
  parts.push(`<text class="tick" x="${WIDTH - PAD.right}" y="${HEIGHT - 8}" text-anchor="end">run ${runs}</text>`);
  spec.series.forEach((series, which) => {
    const color = `s${which % SERIES_CLASSES}`;
    const segments: string[][] = [];
    series.values.forEach((value, index) => {
      if (value === null) {
        segments.push([]);
        return;
      }
      if (segments.length === 0) segments.push([]);
      segments[segments.length - 1].push(`${x(index).toFixed(1)},${y(value).toFixed(1)}`);
    });
    for (const points of segments.filter((each) => each.length > 1)) parts.push(`<polyline class="line ${color}" points="${points.join(" ")}"/>`);
    series.values.forEach((value, index) => {
      if (value === null) return;
      parts.push(
        `<circle class="dot ${color}" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3"><title>${escapeHtml(`${series.name}: ${spec.format(value)} (${spec.runs[index]})`)}</title></circle>`,
      );
    });
  });

  const legend = spec.series
    .map((series, which) => `<li><span class="swatch s${which % SERIES_CLASSES}"></span>${escapeHtml(series.name)}</li>`)
    .join("");
  return [
    `<figure><figcaption>${escapeHtml(spec.title)}</figcaption>`,
    `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeHtml(spec.title)}">${parts.join("")}</svg>`,
    `<ul class="legend">${legend}</ul></figure>`,
  ].join("");
}
