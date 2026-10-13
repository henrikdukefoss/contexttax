import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateJson, estimateText, fmtK } from '../src/tokens.js';

test('estimateText: about 3.7 characters per token, CJK about one per character', () => {
  assert.equal(estimateText(''), 0);
  assert.equal(estimateText('x'.repeat(370)), 100);
  assert.equal(estimateText('漢字テスト'), 5);
});

test('estimateJson: structure at 3 characters per token, descriptions as prose', () => {
  const schema = { type: 'object', properties: { q: { type: 'string', description: 'x'.repeat(37) } } };
  const structure = JSON.stringify({ type: 'object', properties: { q: { type: 'string' } } }).length;
  assert.equal(estimateJson(schema), Math.ceil(structure / 3) + 10);
});

test('fmtK', () => {
  assert.equal(fmtK(860), '860');
  assert.equal(fmtK(9812), '9.8K');
  assert.equal(fmtK(12400), '12.4K');
  assert.equal(fmtK(123456), '123K');
  assert.equal(fmtK(1250000), '1.3M');
});
