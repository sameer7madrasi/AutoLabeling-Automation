/**
 * Minimal SVG primitives shared by the report chart builders.
 *
 * Charts are hand-written SVG rather than a charting library: the output is
 * screenshotted to PNG for pasting into email, so there is no runtime, no CDN
 * dependency, and the markup stays diffable.
 */

export const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";

export const COLORS = {
  pass: '#107c10',
  tbc: '#f2a93b',
  clarification: '#c50f1f',
  fail: '#c50f1f',
  notApplicable: '#8a8886',
  shipped: '#0b5c0b',
  tier1: '#4caf50',
  tier2: '#0f6cbd',
  tier3: '#8661c5',
  tier4: '#8a8886',
  accent: '#0f6cbd',
  ink: '#242424',
  muted: '#616161',
  grid: '#e1dfdd',
  track: '#f3f2f1',
} as const;

export function svgOpen(width: number, height: number): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="${FONT}">`;
}

export interface TextOptions {
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: string;
}

export function text(x: number, y: number, content: string, options: TextOptions = {}): string {
  const { size = 12, weight = 400, fill = COLORS.ink, anchor = 'start' } = options;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}

export function rect(x: number, y: number, w: number, h: number, fill: string, radius = 2): string {
  return `<rect x="${x}" y="${y}" width="${Math.max(w, 0)}" height="${Math.max(h, 0)}" rx="${radius}" fill="${fill}" />`;
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  options: { width?: number; dash?: string } = {},
): string {
  const dash = options.dash ? ` stroke-dasharray="${options.dash}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${options.width ?? 1}"${dash} />`;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function legend(x: number, y: number, entries: { color: string; label: string }[]): string {
  let cursor = x;
  return entries
    .map((entry) => {
      const block = `${rect(cursor, y - 9, 10, 10, entry.color, 2)}${text(cursor + 15, y, entry.label, { size: 11, fill: COLORS.muted })}`;
      // Advance by a deliberately generous estimate of the rendered label width.
      cursor += 30 + entry.label.length * 6.6;
      return block;
    })
    .join('');
}

/** Wraps chart markup in the page shell used for screenshotting. */
export function reportPageStyles(): string {
  return `
  body { font-family: ${FONT}; color: ${COLORS.ink}; margin: 0; padding: 32px; background: #faf9f8; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.lede { color: ${COLORS.muted}; margin: 0 0 24px; font-size: 13px; }
  .chart { background: #fff; border: 1px solid ${COLORS.grid}; border-radius: 6px; padding: 16px; margin-bottom: 20px; width: 650px; box-sizing: content-box; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; background: #fff; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid ${COLORS.grid}; }
  th { background: #f3f2f1; font-weight: 600; }
  h2 { font-size: 15px; margin: 28px 0 10px; }`;
}
