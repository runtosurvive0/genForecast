import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransferModel} from '../src/components/fuel-scene/berth-transfer-model.js';

test('drawing uses current database lots and never retains old fixed heaps', () => {
  const lots = [
    {source_id:'new-pile', location:'P1', coal_name:'Coal A', tonnes:12000, voyage_number:'26-1-010', grade:'고열량', age_days:4, start_m:300, end_m:400},
    {source_id:'new-shed', location:'A6', coal_name:'Coal B', tonnes:5000, voyage_number:'26-3-011', grade:'저열량', age_days:1},
    {source_id:'unknown-position', location:'P2', coal_name:'Coal C', tonnes:3000},
  ];
  const model = createTransferModel({baselineLots:lots});
  try {
    assert.deepEqual([...model.stockMeshes.keys()].sort(), ['new-pile', 'new-shed']);
    assert.equal(model.stockMeshes.get('new-pile').lot.tons, 12000);
    assert.equal(model.stockMeshes.get('new-shed').lot.coal, 'Coal B');
  } finally { model.dispose(); }
});
