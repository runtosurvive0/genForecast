import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoFleet, demoVesselIds, kstParts, withDemoWatchlist } from '../src/data/demo-fleet.ts';
import { vesselCatalog, trackingVoyages } from '../src/data/vessel-workflow.ts';
import { mapFleet } from '../src/features/vessels/vessel-navigation.ts';

test('모의 선박 일정: 접안 선박은 과거, 다음 입항은 언제 열어도 6시간 이상 뒤', () => {
  for (const now of [Date.parse('2026-11-10T13:00:00+09:00'), Date.parse('2026-11-10T23:30:00+09:00'), Date.parse('2027-02-01T00:10:00+09:00')]) {
    const fleet = demoFleet(now);
    for (const v of fleet.filter(v => v.state === 'arrived')) assert.ok(Date.parse(v.arrivalAt) < now, v.name);
    const next = fleet.find(v => v.state !== 'arrived')!;
    assert.ok(Date.parse(next.arrivalAt) - now >= 6 * 3_600_000, `${next.arrivalAt} vs ${new Date(now).toISOString()}`);
    assert.equal(kstParts(next.arrivalAt).time, '06:00');
    const times = fleet.map(v => Date.parse(v.arrivalAt));
    assert.deepEqual([...times].sort((a, b) => a - b), times);
  }
});

test('모의 선박은 부두당 1척만 접안하고 식별자가 합성값임을 드러낸다', () => {
  const fleet = demoFleet(Date.parse('2026-11-10T13:00:00+09:00'));
  const berthed = fleet.filter(v => v.state === 'arrived').map(v => v.berth);
  assert.equal(new Set(berthed).size, berthed.length);
  for (const v of fleet) { assert.match(v.imo, /^DEMO-/); assert.match(v.mmsi, /^999/); }
});

test('관심 목록: 데모 연결 시 모의 선박을 앞에 고정, 해제 시 감춤', () => {
  assert.deepEqual(withDemoWatchlist(['a', demoVesselIds[1]], true), [...demoVesselIds, 'a']);
  assert.deepEqual(withDemoWatchlist(['a', demoVesselIds[1]], false), ['a']);
});

test('선박 지도: 접안·항해 중인 모의 선박을 위치와 함께 그린다(입항 예정은 위치 없음)', () => {
  const rows = demoVesselIds.map(id => ({ vessel: vesselCatalog.find(v => v.id === id)!, voyage: trackingVoyages.find(v => v.vesselId === id) }));
  const fleet = mapFleet(rows);
  assert.deepEqual(fleet.items.map(i => i.vesselName), ['GEN4CAST HORIZON', 'GEN4CAST PACIFIC', 'GEN4CAST OCEAN']);
  assert.ok(fleet.items.every(i => i.source === 'demo'));
  assert.equal(fleet.positions.length, 3);
  assert.equal(fleet.positions.find(p => p.vessel_id === 'demo-gen4cast-horizon')?.navStatus, 5);
});
