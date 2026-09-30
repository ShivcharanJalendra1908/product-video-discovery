import test from 'node:test'; import assert from 'node:assert';
import { toScore } from './brain.js';
test('identical product scores ~100, unrelated scores 0', () => {
  assert.equal(toScore(0.92, 3, 3).score, 100);
  assert.equal(toScore(0.5, 0, 3).score, 0);
});
test('falls back to caption words when no image is available', () => assert.equal(toScore(null, 1, 2).score, 40));
test('text mode uses a lower similarity range', () => assert.equal(toScore(0.3, 3, 3, 'text').score, 100));
