import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeMarkdown, renderBadge, textWidth } from '../src/render/badge.js';

test('badge: shields-style SVG with label and value, no gradient', () => {
  const svg = renderBadge(12400);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20"/);
  assert.match(svg, /aria-label="context tax: 12.4K tokens\/request"/);
  assert.match(svg, /<title>context tax: 12.4K tokens\/request<\/title>/);
  assert.doesNotMatch(svg, /Gradient/);
  assert.equal((svg.match(/<text/g) || []).length, (svg.match(/<\/text>/g) || []).length);
  const w = Number(/width="(\d+)"/.exec(svg)[1]);
  assert.ok(Math.abs(w - (textWidth('context tax') + textWidth('12.4K tokens/request') + 20)) <= 2);
});

test('badge: calm colours by size, navy theme', () => {
  assert.match(renderBadge(1200), /#2e7d5b/);
  assert.match(renderBadge(12400), /#8a6a2c/);
  assert.match(renderBadge(42000), /#9c4632/);
  const navy = renderBadge(12400, { theme: 'navy' });
  assert.match(navy, /#2a3347/);
  assert.match(navy, /#c9a158/);
});

test('badge markdown links to the project', () => {
  assert.equal(badgeMarkdown('context-tax.svg', 860), '[![context tax: 860 tokens/request](context-tax.svg)](https://github.com/henrikdukefoss/contexttax)');
});
