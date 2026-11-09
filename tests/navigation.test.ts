import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageFromHash, pageHash, pageGroup, pageIds } from '../src/domain/navigation.ts';

test('all menu pages round-trip through a stable deep link', () => {
  for (const page of pageIds) assert.equal(pageFromHash(pageHash(page)), page);
});
test('old page links remain usable and invalid paths fall back to overview', () => {
  assert.equal(pageFromHash('#voyages'), 'vessels');
  assert.equal(pageFromHash('#stockyard'), 'yard');
  assert.equal(pageFromHash('#fuel'), 'fuel');
  assert.equal(pageFromHash('#fuel-ledger'), 'fuel');
  assert.equal(pageFromHash('#main-content'), 'overview');
  assert.equal(pageFromHash('#not-a-page'), 'overview');
});
test('purchase review belongs to the simulation workflow', () => {
  assert.equal(pageGroup('procurement'), 'planning');
  assert.equal(pageGroup('yard'), 'operations');
  assert.equal(pageGroup('members'), 'admin');
});
