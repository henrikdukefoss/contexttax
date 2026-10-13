// A README badge in the shields.io "flat" shape: two flat fields, rounded 3px corners,
// Verdana 11px with the usual 1px text shadow. No gradient, no clipPath (ids collide when inlined).
import { fmtK } from '../tokens.js';

// Verdana advance widths at 11px (units per em 2048), for laying out the text.
const WIDTHS = {
  ' ': 3.87, '.': 3.99, ',': 3.99, '/': 5.0, '%': 11.84, '(': 4.99, ')': 4.99, '-': 4.99, ':': 4.99,
  a: 6.6, b: 6.85, c: 5.73, d: 6.85, e: 6.55, f: 3.87, g: 6.85, h: 6.96, i: 3.02, j: 3.79, k: 6.51, l: 3.02, m: 10.7,
  n: 6.96, o: 6.68, p: 6.85, q: 6.85, r: 4.69, s: 5.73, t: 4.33, u: 6.96, v: 6.51, w: 8.99, x: 6.51, y: 6.51, z: 5.78,
  K: 7.62, M: 9.27,
};
const charWidth = (c) => WIDTHS[c] ?? (/\d/.test(c) ? 6.99 : /[A-Z]/.test(c) ? 7.5 : 7);
export const textWidth = (s) => [...s].reduce((w, c) => w + charWidth(c), 0);

// calm tones that hold white 11px text at about 4.5:1
export const THEMES = {
  calm: { label: '#555', labelText: '#fff', value: (t) => (t < 5000 ? '#2e7d5b' : t < 20000 ? '#8a6a2c' : '#9c4632'), valueText: '#fff', shadow: true },
  navy: { label: '#2a3347', labelText: '#d9dee8', value: () => '#c9a158', valueText: '#141926', shadow: false },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function badgeValue(tokens) {
  return `${fmtK(tokens)} tokens/request`;
}

export function renderBadge(tokens, { theme = 'calm', label = 'context tax' } = {}) {
  const t = THEMES[theme] || THEMES.calm;
  const value = badgeValue(tokens);
  const lw = Math.round(textWidth(label) + 10);
  const vw = Math.round(textWidth(value) + 10);
  const w = lw + vw;
  const fill = t.value(tokens);
  // textLength pins the layout when Verdana is missing and a wider fallback font is used
  const text = (x, s, color) => {
    const len = ` textLength="${textWidth(s).toFixed(1)}"`;
    return (
      (t.shadow ? `<text x="${x}" y="15" fill="#010101" fill-opacity=".3"${len} aria-hidden="true">${esc(s)}</text>` : '') +
      `<text x="${x}" y="14" fill="${color}"${len}>${esc(s)}</text>`
    );
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">` +
    `<title>${esc(label)}: ${esc(value)}</title>` +
    `<rect width="${w}" height="20" rx="3" fill="${fill}"/>` +
    `<path d="M3 0H${lw}V20H3A3 3 0 0 1 0 17V3A3 3 0 0 1 3 0Z" fill="${t.label}"/>` +
    `<g text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision">` +
    text(lw / 2, label, t.labelText) +
    text(lw + vw / 2, value, t.valueText) +
    `</g></svg>\n`
  );
}

export function badgeMarkdown(file, tokens) {
  return `[![context tax: ${badgeValue(tokens)}](${file})](https://github.com/henrikdukefoss/contexttax)`;
}
