"use strict";
const { createMaterial } = require("./demo-material.cjs");
const clone = (x) => structuredClone(x),
  moving = new Set(["stacker", "reclaimer", "tripper"]);
function createEngine(catalog) {
  let elapsed = 0,
    playing = false,
    speed = 1,
    equipment,
    units,
    silos,
    material,
    schedule = [],
    ramps = [],
    events = [],
    counter = 0;
  const byId = new Map(catalog.equipment.map((e) => [e.id, e]));
  const log = (message, kind = "change") => {
    events.unshift({ id: ++counter, at: elapsed, message, kind });
    events = events.slice(0, 120);
  };
  function reset() {
    elapsed = 0;
    playing = false;
    speed = 1;
    schedule = [];
    ramps = [];
    equipment = Object.fromEntries(
      catalog.equipment.map((e) => [
        e.id,
        { status: "stopped", setFlow: 0, position: 50 },
      ]),
    );
    material = createMaterial(catalog, equipment);
    units = Object.fromEntries(
      catalog.units.map((u) => [u.id, { status: "running", setMW: u.mw }]),
    );
    silos = Object.fromEntries(catalog.units.flatMap(u => Array.from({length:6}, (_,i) => [`${u.id}-${i+1}`, {tonnes:500, capacity:1000, status:'stopped', setRate:0, consumed:0, received:0, adjusted:0}])));
  }
  reset();
  function number(n, min, max, name) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw Error(`${name}: ${min}–${max} 범위의 숫자를 입력하세요.`);
  }
  function validate(a) {
    if (
      !a ||
      !["equipment", "unit", "feeder"].includes(a.op) ||
      !a.patch ||
      typeof a.patch !== "object" ||
      Array.isArray(a.patch)
    )
      throw Error("유효한 운전 변경을 선택하세요.");
    const c =
      a.op === 'feeder' ? silos[a.id] : a.op === "equipment"
        ? byId.get(a.id)
        : catalog.units.find((u) => String(u.id) === String(a.id));
    if (!c) throw Error("등록되지 않은 설비 또는 호기입니다.");
    const fields = Object.keys(a.patch);
    if (!fields.length) throw Error("변경할 값이 없습니다.");
    for (const k of fields) {
      const v = a.patch[k];
      if (k === "status") {
        if (!["running", "stopped", "fault"].includes(v))
          throw Error("운전 상태가 올바르지 않습니다.");
      } else if (k === 'rate' && a.op === 'feeder') number(v, 0, 1000, '급탄량');
      else if (
        k === "position" &&
        a.op === "equipment" &&
        moving.has(c.kind)
      ) {
        number(v, 0, 100, "주행 위치");
        if (
          material.locked(a.id) &&
          Math.abs(v - equipment[a.id].position) > 0.01
        )
          throw Error("작업 정지 후 주행 위치를 변경하세요.");
      } else if (k === "flow" && a.op === "equipment" && c.kind !== "tower")
        number(v, 0, 5000, "이송량");
      else if (k === "mw" && a.op === "unit") number(v, 0, c.maxMW, "발전출력");
      else throw Error("이 대상에서 조작할 수 없는 항목입니다.");
    }
  }
  const key = (k) => (k === "flow" ? "setFlow" : k === "mw" ? "setMW" : k === 'rate' ? 'setRate' : k);
  const target = (a) => (a.op === 'feeder' ? silos[a.id] : a.op === "equipment" ? equipment[a.id] : units[a.id]);
  function apply(a, duration = 0) {
    validate(a);
    const t = target(a);
    for (const [field, value] of Object.entries(a.patch)) {
      const k = key(field);
      ramps = ramps.filter(
        (r) =>
          !(r.op === a.op && String(r.id) === String(a.id) && r.field === k),
      );
      if (duration > 0 && typeof value === "number")
        ramps.push({
          op: a.op,
          id: a.id,
          field: k,
          from: t[k],
          to: value,
          start: elapsed,
          end: elapsed + duration,
        });
      else t[k] = value;
    }
  }
  function updateRamps(time) {
    for (const r of ramps)
      target(r)[r.field] =
        r.from +
        (r.to - r.from) * Math.min(1, (time - r.start) / (r.end - r.start));
    ramps = ramps.filter((r) => r.end > time);
  }
  function addSchedule(c) {
    validate(c.action);
    number(c.delay, 0, 86400, "예약 지연");
    number(c.duration ?? 0, 0, 86400, "변화 시간");
    if (c.action.op === 'feeder' && c.duration) throw Error('급탄기 예약은 즉시 변경만 지원합니다.');
    if (schedule.length >= 100)
      throw Error("예약은 최대 100개까지 등록할 수 있습니다.");
    schedule.push({
      id: ++counter,
      at: elapsed + c.delay,
      duration: c.duration || 0,
      action: clone(c.action),
      status: "pending",
    });
    schedule.sort((a, b) => a.at - b.at || a.id - b.id);
  }
  function advanceSegment(end) {
    while (elapsed < end) {
      const reclaimJob = material.snapshot().jobs.reclaim;
      const activeSilo = reclaimJob?.running && reclaimJob.siloId;
      const hasFeeder = Object.values(silos).some(s => s.status === 'running' && s.setRate > 0);
      const next = Math.min(
          end,
          (activeSilo || hasFeeder) ? elapsed + 1 : end,
          ...ramps.filter((r) => r.end > elapsed).map((r) => r.end),
        ),
        before = material.begin();
      updateRamps(next);
      const seconds = next - elapsed;
      for (const silo of Object.values(silos)) {
        const consumed = silo.status === 'running' ? Math.min(silo.tonnes, silo.setRate * seconds / 3600) : 0;
        silo.tonnes -= consumed; silo.consumed += consumed;
      }
      const target = material.snapshot().jobs.reclaim?.siloId;
      const silo = target ? silos[target] : null;
      const moved = material.integrate(before, seconds, silo ? Math.max(0, silo.capacity - silo.tonnes) : Infinity);
      if (silo) { silo.tonnes += moved; silo.received += moved; }
      elapsed = next;
    }
  }
  function advance(realSeconds) {
    number(realSeconds, 0, Number.MAX_SAFE_INTEGER, "시간");
    if (!playing) return;
    const end = elapsed + realSeconds * speed;
    for (const item of schedule.filter(
      (s) => s.status === "pending" && s.at <= end,
    )) {
      advanceSegment(item.at);
      try {
        apply(item.action, item.duration);
        item.status = "done";
        log(`예약 실행 · ${label(item.action)}`, "scheduled");
      } catch (error) {
        item.status = "failed";
        log(`예약 미실행 · ${error.message}`, "error");
      }
    }
    advanceSegment(end);
  }
  function label(a) {
    return a.op === 'feeder' ? `${a.id} 급탄기` : a.op === "unit" ? `${a.id}호기` : byId.get(a.id)?.code || a.id;
  }
  function command(c) {
    if (!c || typeof c !== "object")
      throw Error("명령 형식이 올바르지 않습니다.");
    if (c.op === "work") {
      if (c.kind === 'reclaim' && c.running && c.siloId != null) {
        const lot = catalog.materialLots.find(item => item.id === c.lotId);
        const unit = Number(String(c.siloId).split('-')[0]);
        const connected = lot && (lot.yard === 1 ? unit >= 1 && unit <= 4 : lot.yard === 2 ? unit >= 5 && unit <= 8 : unit >= 9 && unit <= 10);
        if (!silos[c.siloId] || !connected) throw Error('선택한 저탄장 주계통에 연결된 사일로를 확인하세요.');
      }
      material.start(c);
      log(
        `${c.kind === "unload" ? "하역·적치" : "상탄"} ${c.running ? "시작 · " + c.lotId : "정지"}`,
      );
    } else if (c.op === 'silo') {
      const silo=silos[c.id], patch=c.patch;
      if (playing || !silo || !patch || typeof patch!=='object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(k=>!['tonnes','capacity'].includes(k))) throw Error('일시정지 후 사일로 설정을 확인하세요.');
      const capacity=patch.capacity ?? silo.capacity, tonnes=patch.tonnes ?? silo.tonnes;
      number(capacity, 1, 100000, '사일로 용량'); number(tonnes, 0, capacity, '사일로 잔량');
      silo.adjusted=(silo.adjusted || 0)+tonnes-silo.tonnes; silo.tonnes=tonnes; silo.capacity=capacity;
      log(`${c.id} 사일로 설정 변경`);
    } else if (c.op === 'feeder') {
      apply(c);
      log(`${c.id} 급탄기 변경`);
    } else if (c.op === "equipment" || c.op === "unit") {
      apply(c);
      log(
        `${label(c)} · ${Object.entries(c.patch)
          .map(([k, v]) =>
            k === "status"
              ? { running: "운전", stopped: "정지", fault: "고장" }[v]
              : `${k === "mw" ? "출력" : k === "flow" ? "이송량" : "위치"} ${v}${k === "mw" ? " MW" : k === "flow" ? " t/h" : "%"}`,
          )
          .join(", ")}`,
      );
    } else if (c.op === "schedule") {
      addSchedule(c);
      log(`예약 등록 · ${label(c.action)}`);
    } else if (c.op === "cancel") {
      const s = schedule.find((s) => s.id === c.id && s.status === "pending");
      if (!s) throw Error("취소할 대기 예약이 없습니다.");
      s.status = "cancelled";
      log("예약 취소");
    } else if (c.op === "play") {
      playing = true;
      log("재생 시작", "clock");
      advance(0);
    } else if (c.op === "pause") {
      playing = false;
      log("일시정지", "clock");
    } else if (c.op === "speed") {
      number(c.value, 1, 3600, "배속");
      speed = c.value;
      log(`${speed}배속`, "clock");
    } else if (c.op === "reset") {
      reset();
      events = [];
      log("초기 스냅샷 복원", "clock");
    } else if (c.op === "preset") {
      reset();
      events = [];
      material.start({
        kind: "unload",
        running: true,
        berth: 2,
        lotId: "p5-c",
        rate: 1200,
      });
      material.start({
        kind: "reclaim",
        running: true,
        lotId: "p6-b",
        rate: 1200,
        siloId: '5-1',
      });
      silos['5-1'].status = 'running';
      silos['5-1'].setRate = 100;
      if (byId.has("cv54a")) {
        addSchedule({
          delay: 60,
          duration: 0,
          action: { op: "equipment", id: "cv54a", patch: { status: "fault" } },
        });
        addSchedule({
          delay: 90,
          duration: 0,
          action: {
            op: "equipment",
            id: "cv54a",
            patch: { status: "running" },
          },
        });
      }
      if (units[7])
        addSchedule({
          delay: 0,
          duration: 120,
          action: { op: "unit", id: 7, patch: { mw: 350 } },
        });
      speed = 60;
      log("예제 준비 · 하역·적치·상탄 / 60초 고장·90초 복구", "clock");
    } else throw Error("지원하지 않는 명령입니다.");
  }
  function snapshot() {
    const materialState = material.snapshot();
    const reclaim = materialState.jobs.reclaim;
    const targetSilo = reclaim?.siloId ? silos[reclaim.siloId] : null;
    const restricted = targetSilo && targetSilo.tonnes >= targetSilo.capacity - 1e-8;
    const availableRate = restricted ? (targetSilo.status === 'running' ? targetSilo.setRate : 0) : Infinity;
    if (restricted && reclaim.actualRate > availableRate) {
      reclaim.actualRate = availableRate;
      reclaim.reason = availableRate ? '사일로 만량 · 급탄량만큼 상탄' : '사일로 만량 · 상탄 대기';
    }
    return clone({
      source: "demo",
      elapsed,
      playing,
      speed,
      baseTime: "2026-11-04T00:00:00.000Z",
      material: materialState,
      equipment: Object.fromEntries(
        Object.entries(equipment).map(([id, e]) => [
          id,
          {
            ...e,
            flow: Math.min(reclaim?.route?.includes(id) ? availableRate : Infinity, material.effective(
              id,
              e.status === "running" ? e.setFlow : 0,
            )),
          },
        ]),
      ),
      units: Object.fromEntries(
        Object.entries(units).map(([id, u]) => [
          id,
          { ...u, mw: u.status === "running" ? u.setMW : 0 },
        ]),
      ),
      silos: Object.fromEntries(Object.entries(silos).map(([id,silo]) => {const actualRate=playing && silo.status === 'running' && silo.tonnes > 0 ? silo.setRate : 0;return [id,{...silo,actualRate,speedPercent:actualRate / 10}];})),
      schedule,
      events,
      ramps: ramps.length,
    });
  }
  function checkpoint() {
    return clone({version:1, elapsed, speed, equipment, units, silos, material:material.snapshot(), schedule, ramps, events, counter});
  }
  function restore(value) {
    // A legacy shared tower signal cannot establish either line's actual state.
    // Preserve stock, but require an explicit restart on the newly split route.
    value = clone(value);
    const splitParents = new Set();
    for (const item of catalog.equipment) {
      if (item.parentId && value?.equipment?.[item.parentId] && !value.equipment[item.id]) {
        splitParents.add(item.parentId);
        value.equipment[item.id] = { status: 'stopped', setFlow: 0, position: 50 };
      }
    }
    if (splitParents.size) {
      for (const job of Object.values(value.material?.jobs || {})) {
        if (!job?.route?.some(id => splitParents.has(id))) continue;
        const lot = value.material.lots[job.lotId];
        const route = job.kind === 'unload'
          ? catalog.routes.find(r => r.berth === job.berth)?.endpoints.find(e => e.id === lot.endpoint)?.assets
          : lot.reclaimRoute;
        if (!route || route.some(id => !byId.has(id))) throw Error('저장된 작업의 이송 경로를 확인하세요.');
        job.route = [...route];
        job.running = false;
        job.reason = '라인별 운전 상태 확인 후 작업을 다시 시작하세요.';
      }
      for (const item of value.schedule || []) {
        if (item.action?.op === 'equipment' && splitParents.has(item.action.id) && item.status === 'pending') item.status = 'cancelled';
      }
      value.ramps = (value.ramps || []).filter(r => !splitParents.has(r.id));
      for (const id of splitParents) delete value.equipment[id];
    }
    if (!value || value.version !== 1 || !Number.isFinite(value.elapsed) || value.elapsed < 0 ||
        !Number.isFinite(value.speed) || value.speed < 1 || value.speed > 3600 ||
        !value.equipment || !value.units || !Array.isArray(value.schedule) || !Array.isArray(value.ramps) || !Array.isArray(value.events) ||
        catalog.equipment.some(e => !value.equipment[e.id]) || catalog.units.some(u => !value.units[u.id]))
      throw Error('저장된 모의 운전 상태를 복원할 수 없습니다.');
    const nextEquipment = clone(value.equipment);
    const nextMaterial = createMaterial(catalog, nextEquipment);
    nextMaterial.restore(value.material);
    elapsed = value.elapsed; speed = value.speed; playing = false;
    equipment = nextEquipment; material = nextMaterial; units = clone(value.units);
    if (value.silos && Object.keys(silos).every(id => value.silos[id] && Number.isFinite(value.silos[id].tonnes))) silos = clone(value.silos);
    schedule = clone(value.schedule); ramps = clone(value.ramps); events = clone(value.events);
    counter = Number.isSafeInteger(value.counter) ? value.counter : 0;
    if (splitParents.size) log('분기 타워 신호를 A·B로 분리했습니다. 해당 작업과 예약을 확인하세요.');
  }
  return { command, advance, snapshot, checkpoint, restore };
}
module.exports = { createEngine };
