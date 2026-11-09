import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateUnload} from '../src/domain/berth-unload-forecast.ts';

test('only a running matching berth with sufficient work remaining yields a ship completion estimate', () => {
  const input = {baseTime:'2026-11-08T00:00:00Z', elapsed:3600, playing:true, online:true,
    berth:1, job:{berth:1,actualRate:1000,amount:3000,moved:0},remaining:2000};
  assert.deepEqual(estimateUnload(input), {kind:'ship',at:'2026-11-08T03:00:00.000Z'});
  assert.equal(estimateUnload({...input,berth:2}),null);
  assert.equal(estimateUnload({...input,playing:false}),null);
  assert.equal(estimateUnload({...input,job:{...input.job,actualRate:0}}),null);
  assert.deepEqual(estimateUnload({...input,job:{...input.job,amount:1000}}),{kind:'work',at:'2026-11-08T02:00:00.000Z'});
});
