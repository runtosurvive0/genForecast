"use strict";
// Disposable physical stock, seeded from the photograph. No production ledger writes.
function createMaterial(catalog, equipment) {
  const lots = Object.fromEntries(
    (catalog.materialLots || []).map((l) => [
      l.id,
      { ...structuredClone(l), baseTons: l.tons, received: 0, reclaimed: 0 },
    ]),
  );
  const baselineStock = Object.values(lots).reduce(
    (sum, lot) => sum + lot.baseTons,
    0,
  );
  const ships = {
    1: { name: "GN-A · 시연", total: 75000, remaining: 43800, unloaded: 31200 },
    2: { name: "GN-B · 시연", total: 82000, remaining: 63400, unloaded: 18600 },
  };
  const jobs = { unload: null, reclaim: null };
  let received = 0,
    outbound = 0;
  const meta = new Map(catalog.equipment.map((e) => [e.id, e]));
  function start(c) {
    if (
      !["unload", "reclaim"].includes(c.kind) ||
      typeof c.running !== "boolean"
    )
      throw Error("하역 또는 상탄 작업을 선택하세요.");
    if (!c.running) {
      const old = jobs[c.kind];
      if (old) {
        old.running = false;
        for (const id of old.route) equipment[id].status = "stopped";
      }
      return;
    }
    const lot = lots[c.lotId];
    if (!lot || !lot.usable) throw Error("사용 가능한 재고 구역을 선택하세요.");
    if (
      typeof c.rate !== "number" ||
      !Number.isFinite(c.rate) ||
      c.rate <= 0 ||
      c.rate > 5000
    )
      throw Error("작업 이송량은 0 초과 5,000 t/h 이하입니다.");
    let route, machine;
    if (c.kind === "unload") {
      if (!ships[c.berth]) throw Error("접안 선박이 없는 부두입니다.");
      if (lot.baseTons !== 0)
        throw Error("기존 재고와 혼합하지 않도록 소진 구역을 선택하세요.");
      route = catalog.routes
        .find((r) => r.berth === c.berth)
        ?.endpoints.find((e) => e.id === lot.endpoint)?.assets;
      if (!route?.length)
        throw Error("이 부두에서 해당 구역에 접근할 수 없습니다.");
      machine = route.at(-1);
    } else {
      if (lot.tons <= 0) throw Error("상탄할 재고가 없습니다.");
      if (!lot.reclaimRoute)
        throw Error("이 구역의 상탄 경로는 아직 모사하지 않습니다.");
      route = lot.reclaimRoute;
      machine = route[0];
    }
    const amount = c.amount ?? (c.kind === "unload" ? 2000 : lot.tons);
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 100000
    )
      throw Error("작업량은 0 초과 100,000 t 이하입니다.");
    const other = jobs[c.kind === "unload" ? "reclaim" : "unload"];
    if (other?.running && route.some((id) => other.route.includes(id)))
      throw Error("다른 작업이 사용 중인 이송 경로입니다.");
    const pose = lot.poses[c.kind],
      position = pose.position;
    const old = jobs[c.kind];
    if (old)
      for (const id of old.route)
        if (!route.includes(id)) equipment[id].status = "stopped";
    jobs[c.kind] = {
      kind: c.kind,
      running: true,
      lotId: lot.id,
      berth: c.berth || null,
      rate: c.rate,
      route: [...route],
      machine,
      pose: { ...pose },
      amount,
      moved: 0,
      siloId: c.kind === 'reclaim' ? (c.siloId ?? null) : null,
    };
    if (c.kind === "unload") lot.demoLabel = `${c.berth}부두 새 적치 · 데모`;
    for (const id of route) {
      equipment[id].status = "running";
      if (meta.get(id).kind !== "tower") equipment[id].setFlow = c.rate;
    }
    equipment[machine].position = position;
  }
  function condition(job) {
    if (!job || !job.running) return "작업 정지";
    if (job.kind === "unload" && ships[job.berth].remaining <= 0)
      return "선박 하역 완료";
    if (job.kind === "reclaim" && lots[job.lotId].tons <= 0) return "재고 소진";
    if (job.moved >= job.amount - 1e-8) return "작업량 완료";
    const stopped = job.route.find((id) => equipment[id].status !== "running");
    if (stopped)
      return `${meta.get(stopped).code} ${equipment[stopped].status === "fault" ? "고장" : "정지"} · 이송 대기`;
    const empty = job.route.find(
      (id) => meta.get(id).kind !== "tower" && equipment[id].setFlow <= 0,
    );
    if (empty) return `${meta.get(empty).code} 유량 0 · 이송 대기`;
    return "";
  }
  function rate(job) {
    if (condition(job)) return 0;
    return Math.min(
      job.rate,
      ...job.route
        .filter((id) => meta.get(id).kind !== "tower")
        .map((id) => equipment[id].setFlow),
    );
  }
  function rates(job) {
    return [
      job.rate,
      ...job.route
        .filter((id) => meta.get(id).kind !== "tower")
        .map((id) => equipment[id].setFlow),
    ];
  }
  // Integral of the minimum of linearly ramped belt rates, split at every crossing.
  function integral(a, b, seconds) {
    const cuts = [0, 1];
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) {
        const d = b[i] - a[i] - (b[j] - a[j]);
        if (d) {
          const t = (a[j] - a[i]) / d;
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    cuts.sort((x, y) => x - y);
    let sum = 0;
    const at = (t) =>
      Math.max(0, Math.min(...a.map((v, i) => v + (b[i] - v) * t)));
    for (let i = 1; i < cuts.length; i++)
      sum += ((at(cuts[i - 1]) + at(cuts[i])) / 2) * (cuts[i] - cuts[i - 1]);
    return (sum * seconds) / 3600;
  }
  function begin() {
    return Object.fromEntries(
      Object.entries(jobs).map(([k, j]) => [
        k,
        j &&
        j.running &&
        !j.route.some((id) => equipment[id].status !== "running")
          ? rates(j)
          : null,
      ]),
    );
  }
  function integrate(before, seconds, reclaimLimit = Infinity) {
    let reclaimedNow = 0;
    for (const [kind, job] of Object.entries(jobs)) {
      if (!job || !before[kind]) continue;
      let amount = Math.min(
        Math.max(0, job.amount - job.moved),
        integral(before[kind], rates(job), seconds),
      );
      const lot = lots[job.lotId];
      if (kind === "unload") {
        amount = Math.min(amount, ships[job.berth].remaining);
        ships[job.berth].remaining -= amount;
        ships[job.berth].unloaded += amount;
        lot.tons += amount;
        lot.received += amount;
        received += amount;
      } else {
        amount = Math.min(amount, lot.tons, reclaimLimit);
        lot.tons -= amount;
        lot.reclaimed += amount;
        outbound += amount;
        reclaimedNow += amount;
      }
      job.moved += amount;
      lot.tons = lot.baseTons + lot.received - lot.reclaimed;
      if (Math.abs(lot.tons) < 1e-7) lot.tons = 0;
    }
    return reclaimedNow;
  }
  function snapshot() {
    const output = {};
    for (const [k, j] of Object.entries(jobs))
      output[k] = j
        ? { ...j, actualRate: rate(j), reason: condition(j) || "이송 중" }
        : null;
    return {
      lots,
      ships,
      jobs: output,
      received,
      outbound,
      totalStock: Object.values(lots).reduce((n, l) => n + l.tons, 0),
      baselineStock,
    };
  }
  function effective(id, fallback) {
    const owned = Object.values(jobs).filter((j) => j?.route.includes(id));
    return owned.length ? owned.reduce((n, j) => n + rate(j), 0) : fallback;
  }
  function locked(id) {
    return Object.values(jobs).some((j) => j?.running && j.machine === id);
  }
  function restore(value) {
    if (!value || !value.lots || !value.ships || !value.jobs ||
        Object.keys(lots).some(id => !value.lots[id] || !Number.isFinite(value.lots[id].tons) || value.lots[id].tons < 0) ||
        Object.keys(ships).some(id => !value.ships[id] || !Number.isFinite(value.ships[id].remaining) || value.ships[id].remaining < 0) ||
        !Number.isFinite(value.received) || !Number.isFinite(value.outbound)) throw Error('저장된 모의 물량을 복원할 수 없습니다.');
    for (const id of Object.keys(lots)) Object.assign(lots[id], structuredClone(value.lots[id]));
    for (const id of Object.keys(ships)) Object.assign(ships[id], structuredClone(value.ships[id]));
    for (const kind of Object.keys(jobs)) jobs[kind] = structuredClone(value.jobs[kind] || null);
    received = value.received; outbound = value.outbound;
  }
  return { start, begin, integrate, snapshot, effective, locked, restore };
}
module.exports = { createMaterial };
