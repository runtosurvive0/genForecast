/* Reachability contract copied from the existing stockyard source, not voyage fixtures.
 * Source: src/features/stockyard/site-layout.ts UNLOAD_LINES / canUnload;
 * regression: tests/stockyard.test.ts "unload lines ... blocked piles".
 * Connectivity does not imply present availability, capacity, or a discharge assignment.
 * The source-backed conveyor topology is provided separately in berth-network.js.
 */
export const BerthRoutes = (() => {
  'use strict';
  const yards = Object.freeze([
    Object.freeze({id:1,label:'1저탄장',kind:'옥외',restriction:null,ids:['pile-1','pile-2','pile-3','pile-4']}),
    Object.freeze({id:2,label:'2저탄장',kind:'옥내',restriction:null,ids:['pile-5','pile-6','pile-7','pile-8']}),
    Object.freeze({id:3,label:'3저탄장',kind:'옥내',restriction:null,ids:['shed-a','shed-b']})
  ]);
  const endpoints = Object.freeze(yards.flatMap(y => y.ids.map((id,i) => Object.freeze({
    id,yard:y.id,label:y.id<3?'Pile '+(i+(y.id===1?1:5)):(i===0?'A':'B')+' Shed',
    pileNo:y.id<3?i+(y.id===1?1:5):null,
    restriction:y.restriction
  }))));
  const blocked = Object.freeze({1:Object.freeze(['pile-7','pile-8']),2:Object.freeze(['pile-3','pile-4']),3:Object.freeze(['pile-3','pile-4'])});
  const endpoint = id => endpoints.find(e => e.id === id) || null;
  const canReach = (berth,id) => !!blocked[berth] && !!endpoint(id) && !blocked[berth].includes(id);
  const forBerth = berth => endpoints.map(e => ({...e,reachable:canReach(berth,e.id)}));
  const normalize = (berth,id) => canReach(berth,id) ? id : null;
  return  Object.freeze({yards,endpoints,endpoint,canReach,forBerth,normalize,blocked,
    source:'기존 저탄장 구조 자료',
    // This is a local inspection selection. It is never persisted as a discharge plan.
    status(berth,id) {
      const e=endpoint(id);
      if(!e || !blocked[berth]) return {reachable:false,reason:'연결 정보 없음'};
      if(!canReach(berth,id)) return {reachable:false,reason:berth+'부두에서 반입 불가'};
      return {reachable:true,reason:e.restriction||'연결 가능 · 현재 운전 가능 여부 미연결'};
    }
  });
})();
