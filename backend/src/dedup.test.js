import test from 'node:test'; import assert from 'node:assert';
import { dedupe } from './dedup.js';
const v = (id, caption) => ({ id, caption });
test('drops same id, seen ids and near-duplicate captions', () => {
  const cap = 'black oversized graphic tee with dragon print summer drop';
  const { fresh, repeats } = dedupe([v('a', cap), v('a', cap), v('b', cap + ' now'), v('c', 'totally different protein bar review'), v('d', 'old one')], new Set(['d']));
  assert.deepEqual(fresh.map(x => x.id), ['a', 'c']);
  assert.deepEqual(repeats.map(x => x.id), ['d']);
});
