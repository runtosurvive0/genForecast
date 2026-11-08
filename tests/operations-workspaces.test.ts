import test from "node:test";
import assert from "node:assert/strict";
import {
  completeTotal,
  reviewReceipt,
  reviewPileReceipt,
  reviewRouteSignals,
} from "../src/features/operations/workspace-review.ts";

test('route signals require a fresh matching stream and do not invent missing equipment states', () => {
  const catalog = {routes:[{berth:2,endpoints:[{id:'pile-7',assets:['cv54b','sr51b']}]}]} as any;
  const snapshot = {source:'demo',playing:true,equipment:{cv54b:{status:'running',flow:200},sr51b:{status:'stopped',flow:0}}} as any;
  assert.equal(reviewRouteSignals('stale',snapshot,catalog,2,'pile-7').state,'unavailable');
  assert.equal(reviewRouteSignals('online',snapshot,catalog,1,'pile-7').state,'unavailable');
  const result=reviewRouteSignals('online',snapshot,catalog,2,'pile-7');
  assert.equal(result.state,'connected');
  assert.deepEqual(result.signals.map(s=>s.status),['running','stopped']);
  delete snapshot.equipment.sr51b;
  assert.deepEqual(reviewRouteSignals('online',snapshot,catalog,2,'pile-7').signals.map(s=>s.status),['running','unknown']);
});

const pileInput = { berth: 1, endpoint: 'pile-7', arrival: '2027-01-02', quantity: 1000, capacity: 5000, projectedStock: 4000, storageDays: 3, useStart: '2027-01-02', dailyUse: 400 };
test('pile review distinguishes route, capacity, and planned use without asserting equipment availability', () => {
  const blocked = reviewPileReceipt(pileInput);
  assert.equal(blocked.route, 'blocked');
  assert.equal(blocked.space, 'sufficient');
  assert.equal(blocked.usage, 'complete');
  assert.equal(blocked.storageEnd, '2027-01-05');
  assert.equal(blocked.remaining, 0);
  assert.equal(reviewPileReceipt({...pileInput, berth: 2}).route, 'reachable');
  assert.equal(reviewPileReceipt({...pileInput, projectedStock: 4001}).space, 'insufficient');
  assert.equal(reviewPileReceipt({...pileInput, dailyUse: 200}).remaining, 400);
  assert.equal(reviewPileReceipt({...pileInput, dailyUse: 200}).usage, 'insufficient');
});
test('pile review withholds decisions for missing and invalid evidence', () => {
  assert.equal(reviewPileReceipt({...pileInput, berth: null}).route, 'unknown');
  assert.equal(reviewPileReceipt({...pileInput, endpoint: 'invalid'}).route, 'unknown');
  assert.equal(reviewPileReceipt({...pileInput, projectedStock: null}).space, 'unknown');
  assert.equal(reviewPileReceipt({...pileInput, quantity: 0}).space, 'unknown');
  assert.equal(reviewPileReceipt({...pileInput, dailyUse: null}).usage, 'unknown');
  assert.equal(reviewPileReceipt({...pileInput, dailyUse: -1}).usage, 'unknown');
  assert.equal(reviewPileReceipt({...pileInput, arrival: '2027-02-31'}).usage, 'unknown');
  assert.equal(reviewPileReceipt({...pileInput, useStart: '2027-01-06'}).remaining, 1000);
});

test("workspace period total retains real zero and withholds partial or invalid periods", () => {
  assert.equal(completeTotal([0, 0], 2), 0);
  assert.equal(completeTotal([10, null], 2), null);
  assert.equal(completeTotal([10], 2), null);
  assert.equal(completeTotal([10, Number.NaN], 2), null);
  assert.equal(completeTotal([10, 20], 2), 30);
});
const rows = [
  { day: "2027-01-01", stock: 90_000, days: 30 },
  { day: "2027-01-02", stock: 80_000, days: 26 },
  { day: "2027-01-03", stock: 70_000, days: 23 },
];
const base = {
  start: "2027-01-01",
  arrival: "2027-01-02",
  quantity: 25_000,
  capacity: 100_000,
  leadDays: 2,
  storageDays: 7,
};
test("receipt review compares assumptions with returned stock without changing its forecast", () => {
  const before = JSON.stringify(rows);
  const result = reviewReceipt(rows, base);
  assert.equal(result.headroom, 20_000);
  assert.equal(result.overCapacity, true);
  assert.equal(result.earliestArrival, "2027-01-03");
  assert.equal(result.tooEarly, true);
  assert.equal(result.storageWindowCovered, false);
  assert.equal(JSON.stringify(rows), before);
});
test('first space date respects lead time, capacity and missing forecast days', () => {
  const assumptions={...base,leadDays:0,quantity:25_000};
  assert.equal(reviewReceipt(rows,assumptions).firstAvailable,'2027-01-03');
  assert.equal(reviewReceipt(rows,{...assumptions,leadDays:3}).spaceStatus,'outside-horizon');
  assert.equal(reviewReceipt(rows,{...assumptions,quantity:40_000}).spaceStatus,'not-found');
  assert.equal(reviewReceipt([rows[0],{...rows[1],stock:null},rows[2]],assumptions).spaceStatus,'incomplete');
  assert.equal(reviewReceipt([rows[0],rows[2]],assumptions).firstAvailable,null);
  assert.equal(reviewReceipt(rows,{...assumptions,capacity:null}).spaceStatus,'missing-input');
  assert.equal(reviewReceipt([{...rows[0],stock:-1},rows[1],rows[2]],assumptions).spaceStatus,'incomplete');
});
test("receipt review never invents capacity, stock, or missing horizon results", () => {
  assert.equal(reviewReceipt(rows, { ...base, capacity: null }).headroom, null);
  assert.equal(
    reviewReceipt(rows, { ...base, arrival: "2027-02-01" }).headroom,
    null,
  );
  assert.equal(
    reviewReceipt([{ day: "2027-01-02", stock: null, days: null }], base)
      .headroom,
    null,
  );
  assert.equal(
    reviewReceipt(rows, { ...base, capacity: null }).overCapacity,
    null,
  );
});
test("negative stock is shortage and does not inflate receiving headroom", () => {
  const result = reviewReceipt(
    [{ day: "2027-01-02", stock: -10, days: -1 }],
    base,
  );
  assert.equal(result.shortage, true);
  assert.equal(result.headroom, null);
});
test("invalid numeric assumptions and date inputs are withheld", () => {
  const result = reviewReceipt(rows, {
    ...base,
    arrival: "2027-02-31",
    quantity: -1,
    capacity: 0,
    leadDays: -2,
    storageDays: 1.5,
  });
  assert.equal(result.valid, false);
  assert.equal(result.headroom, null);
  assert.equal(result.earliestArrival, null);
});

import { berthObservation, matchCargo } from '../src/domain/berth-ais.ts';
import type {TrackingVessel} from '../src/domain/vessel-workflow.ts';
test('berth detection separates measured dock faces, ambiguous boundaries, traffic and stale positions',()=>{
  const stamp='2026-11-06T01:00:00Z', now=Date.parse(stamp);
  const v:TrackingVessel={id:'test',mmsi:'440000001',imo:'',name:'Test',source:'aisstream',
    ais:{shipType:70,navStatus:5,destination:'',updatedAt:stamp,position:{longitude:126.5113,latitude:37.0649,observedAt:stamp,sogKn:0,cogDeg:null}}};
  for(const [id,lon,lat] of [[1,126.5113,37.0649],[2,126.507,37.06624],[3,126.5037,37.0674]]) {
    Object.assign(v.ais!.position!,{longitude:lon,latitude:lat});assert.equal(berthObservation(v,now)?.berth,id);
    assert.equal(berthObservation(v,now)?.estimated,true);
  }
  Object.assign(v.ais!.position!,{longitude:126.5054,latitude:37.0668});
  assert.equal(berthObservation(v,now)?.estimated,false);
  assert.equal(berthObservation(v,now+3600001)?.stale,true);
  assert.equal(berthObservation(v,now+3600001)?.estimated,false);
  assert.equal(berthObservation(v,now+86400001),null);
  v.ais!.position!.sogKn=6;assert.equal(berthObservation(v,now),null);
  v.ais!.position!.sogKn=0;v.ais!.shipType=52;assert.equal(berthObservation(v,now),null);
  const plan={voyage_no:'a',ship_code:'s',status:'unloading',destination_port:'당진'};
  const registry={ships:[{ship_code:'s',mmsi:v.mmsi}],voyages:[plan],cargo:[{voyage_no:'a',destination_plant_id:'dangjin',received_t:0}]};
  assert.equal(matchCargo(v,registry)?.cargo[0].received_t,0);
  const simulated = { ...plan, classification: 'simulation' };
  assert.equal(matchCargo(v, {...registry, voyages:[simulated]}), null);
  registry.voyages.push({...plan,voyage_no:'b'});assert.equal(matchCargo(v,registry),null);
});
