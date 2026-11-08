import { useState, type FormEvent } from "react";
import { useFuelDemo } from "../../domain/fuel-demo";
import type {
  FuelDemoAction,
  FuelDemoCatalog,
  FuelDemoCommand,
  FuelDemoRunStatus,
  FuelDemoSnapshot,
  FuelDemoWorkKind,
} from "../../domain/fuel-demo/types";
import "./fuel-demo-control.css";

const statusLabels = {
  disabled: "데모 연결 꺼짐",
  connecting: "연결 중",
  online: "정상 수신",
  stale: "수신 지연 · 마지막 값",
  disconnected: "연결 끊김 · 마지막 값",
};
const runLabels: Record<FuelDemoRunStatus, string> = {
  running: "운전",
  stopped: "정지",
  fault: "고장",
};
const kindLabels: Record<string, string> = {
  belt: "벨트 컨베이어",
  tower: "이송·분기 타워",
  stacker: "상하탄기",
  reclaimer: "상탄기",
  tripper: "트리퍼",
  unloader: "연속식 하역기",
};
const fmt = (value: number) =>
  value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const clock = (base: string, seconds: number) =>
  new Date(Date.parse(base) + seconds * 1000).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
type Selection = { op: "equipment"; id: string } | { op: "unit"; id: number };
type Send = (command: FuelDemoCommand, message?: string) => Promise<void>;

function WorkForm({
  kind,
  catalog,
  snapshot,
  disabled,
  send,
}: {
  kind: FuelDemoWorkKind;
  catalog: FuelDemoCatalog;
  snapshot: FuelDemoSnapshot;
  disabled: boolean;
  send: Send;
}) {
  const candidates = catalog.materialLots.filter(
    (lot) =>
      lot.usable && (kind === "unload" ? lot.tons === 0 : !!lot.reclaimRoute),
  );
  const options =
    kind === "unload"
      ? [1, 2].flatMap((berth) =>
          candidates
            .filter((lot) =>
              catalog.routes
                .find((route) => route.berth === berth)
                ?.endpoints.some((endpoint) => endpoint.id === lot.endpoint),
            )
            .map((lot) => ({
              value: `${berth}|${lot.id}`,
              label: `${berth}부두 → Pile ${lot.pile} · 소진 구역`,
            })),
        )
      : candidates.map((lot) => ({
          value: lot.id,
          label: `${lot.yard}저탄 · Pile ${lot.pile} · ${lot.coal}`,
        }));
  const preferred = kind === "unload" ? "2|p5-c" : "p6-b";
  const [lot, setLot] = useState(
    options.some((option) => option.value === preferred)
      ? preferred
      : (options[0]?.value ?? ""),
  );
  const [rate, setRate] = useState(1200),
    [amount, setAmount] = useState(kind === "unload" ? 2000 : 1958);
  const [siloId, setSiloId] = useState(() => {const yard=candidates.find(item=>item.id===lot)?.yard;return `${yard===1?1:yard===3?9:5}-1`;});
  const job = snapshot.material.jobs[kind],
    running = !!job?.running;
  const selected = running
    ? kind === "unload"
      ? `${job.berth}|${job.lotId}`
      : job.lotId
    : lot;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (running) {
      void send({ op: "work", kind, running: false }, "작업을 정지했습니다.");
      return;
    }
    const [berth, lotId] = lot.split("|");
    void send(
      {
        op: "work",
        kind,
        running: true,
        lotId: kind === "unload" ? lotId : lot,
        berth: kind === "unload" ? Number(berth) : undefined,
        rate,
        amount,
        siloId: kind === 'reclaim' ? siloId : undefined,
      },
      "작업 준비 완료 · 가상 운전 시계를 재생하면 물량이 이동합니다.",
    );
  };
  return (
    <form className="fdc-work-form" onSubmit={submit}>
      <h3>{kind === "unload" ? "하역·적치" : "상탄"}</h3>
      <label>
        작업 구역
        <select
          aria-label={`${kind === "unload" ? "하역" : "상탄"} 작업 구역`}
          value={selected}
          disabled={disabled || running}
          onChange={(event) => {setLot(event.target.value); if(kind==='reclaim'){const yard=candidates.find(item=>item.id===event.target.value)?.yard;setSiloId(`${yard===1?1:yard===3?9:5}-1`);}}}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {kind === 'reclaim' && <label>상탄 대상 사일로<select aria-label="상탄 대상 사일로" value={running ? (job.siloId ?? '') : siloId} disabled={disabled || running} onChange={event=>setSiloId(event.target.value)}>{running && !job.siloId && <option value="">미지정</option>}{catalog.units.filter(unit=>{const yard=candidates.find(item=>item.id===(running?job.lotId:lot))?.yard;return yard===1?unit.id<=4:yard===3?unit.id>=9:unit.id>=5&&unit.id<=8;}).flatMap(unit=>Array.from({length:6},(_,i)=><option key={`${unit.id}-${i+1}`} value={`${unit.id}-${i+1}`}>{unit.id}호기 · 사일로 {i+1}</option>))}</select></label>}
      <label>
        이송량 · t/h
        <input
          aria-label={`${kind === "unload" ? "하역" : "상탄"} 이송량`}
          type="number"
          min="1"
          max="5000"
          step="any"
          value={running ? job.rate : rate}
          required
          disabled={disabled || running}
          onChange={(event) => setRate(event.target.valueAsNumber)}
        />
      </label>
      <label>
        작업량 · t
        <input
          aria-label={`${kind === "unload" ? "하역" : "상탄"} 작업량`}
          type="number"
          min="1"
          max="100000"
          step="any"
          value={running ? job.amount : amount}
          required
          disabled={disabled || running}
          onChange={(event) => setAmount(event.target.valueAsNumber)}
        />
      </label>
      <button type="submit" disabled={disabled || (!running && !lot)}>
        {running ? "정지" : "시작"}
      </button>
      <output>
        {job
          ? `${job.actualRate > 0 && !snapshot.playing ? "일시정지" : job.reason} · ${fmt(job.actualRate)} t/h · ${fmt(job.moved)} / ${fmt(job.amount)} t`
          : "작업 대기 · 연결 설비를 함께 가동합니다."}
      </output>
    </form>
  );
}

function SiloControl({snapshot, disabled, send}: {snapshot:FuelDemoSnapshot;disabled:boolean;send:Send}) {
  const [unit,setUnit]=useState(5), [slot,setSlot]=useState(1), [rate,setRate]=useState(100), [delay,setDelay]=useState(60);
  const [capacity,setCapacity]=useState(''), [tonnes,setTonnes]=useState('');
  const id=`${unit}-${slot}`, silo=snapshot.silos?.[id];
  return <section className="fdc-section" aria-label="사일로와 급탄기 조작"><h2>사일로 · Coal Feeder</h2>
    <p className="fdc-muted">모의 초기값: 사일로당 용량 1,000 t, 잔량 500 t. 속도비는 정격 1,000 t/h에 선형 비례한다고 가정합니다.</p>
    {!silo ? <p>사일로 운전 정보를 기다립니다. 모의 운전 서버를 최신 버전으로 실행해 주세요.</p> : <>
      <div className="fdc-work-form"><label>호기<select aria-label="급탄기 호기" value={unit} onChange={e=>setUnit(Number(e.target.value))}>{Array.from({length:10},(_,i)=><option key={i+1} value={i+1}>{i+1}호기</option>)}</select></label>
      <label>사일로<select aria-label="급탄기 사일로" value={slot} onChange={e=>setSlot(Number(e.target.value))}>{Array.from({length:6},(_,i)=><option key={i+1} value={i+1}>{i+1}번</option>)}</select></label>
      <label>급탄 설정 (t/h)<input aria-label="급탄 설정" type="number" min="0" max="1000" value={rate} onChange={e=>setRate(e.target.valueAsNumber)}/></label>
      <button disabled={disabled} onClick={()=>void send({op:'feeder',id,patch:{status:'running',rate}})}>급탄 시작</button>
      <button disabled={disabled} onClick={()=>void send({op:'feeder',id,patch:{status:'stopped'}})}>정지</button>
      <button disabled={disabled} onClick={()=>void send({op:'feeder',id,patch:{status:'fault'}})}>고장</button>
      <label>예약 지연 (초)<input aria-label="급탄 예약 지연" type="number" min="0" max="86400" value={delay} onChange={e=>setDelay(e.target.valueAsNumber)}/></label>
      <button disabled={disabled} onClick={()=>void send({op:'schedule',delay,duration:0,action:{op:'feeder',id,patch:{status:'running',rate}}},'급탄 시작을 예약했습니다.')}>시작 예약</button></div>
      <div className="fdc-work-form"><label>모의 용량 (t)<input aria-label="모의 사일로 용량" type="number" min="1" max="100000" placeholder={String(silo.capacity)} value={capacity} onChange={e=>setCapacity(e.target.value)}/></label>
      <label>모의 잔량 (t)<input aria-label="모의 사일로 잔량" type="number" min="0" placeholder={String(silo.tonnes)} value={tonnes} onChange={e=>setTonnes(e.target.value)}/></label>
      <button disabled={disabled || snapshot.playing || (!capacity && !tonnes)} onClick={()=>void send({op:'silo',id,patch:{...(capacity?{capacity:Number(capacity)}:{}),...(tonnes?{tonnes:Number(tonnes)}:{})}},'모의 사일로 설정을 저장했습니다.')}>설정 적용</button></div>
      {snapshot.playing && <p className="fdc-muted">용량과 잔량은 일시정지 후 변경할 수 있습니다.</p>}
      <p>잔량 {fmt(silo.tonnes)} / {fmt(silo.capacity)} t · 급탄 {fmt(silo.actualRate)} t/h · 속도비 {silo.speedPercent == null ? '미연결' : `${fmt(silo.speedPercent)}%`} · 누적 {fmt(silo.consumed)} t · {runLabels[silo.status]}</p>
    </>}
  </section>;
}

function Editor({
  selection,
  catalog,
  snapshot,
  disabled,
  send,
}: {
  selection: Selection;
  catalog: FuelDemoCatalog;
  snapshot: FuelDemoSnapshot;
  disabled: boolean;
  send: Send;
}) {
  const equipment =
    selection.op === "equipment"
      ? catalog.equipment.find((item) => item.id === selection.id)!
      : null;
  const unit =
    selection.op === "unit"
      ? catalog.units.find((item) => item.id === selection.id)!
      : null;
  const record =
    selection.op === "equipment"
      ? snapshot.equipment[selection.id]
      : snapshot.units[selection.id];
  const currentValue =
    selection.op === "unit"
      ? snapshot.units[selection.id].setMW
      : snapshot.equipment[selection.id].setFlow;
  const currentPosition =
    selection.op === "equipment"
      ? snapshot.equipment[selection.id].position
      : 0;
  const [status, setStatus] = useState(record.status),
    [value, setValue] = useState(currentValue),
    [position, setPosition] = useState(currentPosition);
  const [delay, setDelay] = useState(30),
    [duration, setDuration] = useState(0);
  const movable =
    !!equipment && ["stacker", "reclaimer", "tripper"].includes(equipment.kind);
  const hasValue = selection.op === "unit" || equipment?.kind !== "tower";
  function action(): FuelDemoAction {
    return selection.op === "unit"
      ? { ...selection, patch: { status, mw: value } }
      : {
          ...selection,
          patch: {
            status,
            ...(hasValue ? { flow: value } : {}),
            ...(movable ? { position } : {}),
          },
        };
  }
  return (
    <section
      className="fdc-panel fdc-editor"
      aria-labelledby="fdc-editor-heading"
    >
      <div className="fdc-heading">
        <h2 id="fdc-editor-heading">
          {equipment?.code ?? `${selection.id}호기`}
        </h2>
        <span>운전값 편집</span>
      </div>
      <p className="fdc-muted">
        {equipment
          ? (kindLabels[equipment.kind] ?? equipment.kind)
          : `설비용량 ${fmt(unit!.maxMW)} MW`}
      </p>
      <p className="fdc-reading">
        수신값{" "}
        <strong>
          {runLabels[record.status]} ·{" "}
          {fmt(
            selection.op === "unit"
              ? snapshot.units[selection.id].mw
              : snapshot.equipment[selection.id].flow,
          )}{" "}
          {selection.op === "unit" ? "MW" : "t/h"}
        </strong>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const scheduled =
            (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
              "value",
            ) === "schedule";
          void send(
            scheduled
              ? { op: "schedule", delay, duration, action: action() }
              : action(),
            scheduled
              ? "운전 스케줄에 등록했습니다."
              : "운전값이 적용됐습니다.",
          );
        }}
      >
        <fieldset disabled={disabled}>
          <legend>운전 상태</legend>
          <div className="fdc-state-picker">
            {(Object.keys(runLabels) as FuelDemoRunStatus[]).map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={status === item}
                onClick={() => setStatus(item)}
              >
                {runLabels[item]}
              </button>
            ))}
          </div>
          {hasValue && (
            <label className="fdc-field">
              {selection.op === "unit" ? "발전출력 · MW" : "이송량 · t/h"}
              <input
                aria-label="변경 운전값"
                type="number"
                min="0"
                max={unit?.maxMW ?? 5000}
                step="any"
                required
                value={value}
                onChange={(event) => setValue(event.target.valueAsNumber)}
              />
            </label>
          )}
          {movable && (
            <label className="fdc-field">
              주행 위치 · {fmt(position)}%
              <input
                aria-label="주행 위치"
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={position}
                onChange={(event) => setPosition(event.target.valueAsNumber)}
              />
            </label>
          )}
          <div className="fdc-editor-actions">
            <button type="submit" className="fdc-primary">
              지금 적용
            </button>
            <button
              type="button"
              onClick={() => {
                setStatus(record.status);
                setValue(currentValue);
                setPosition(currentPosition);
              }}
            >
              수신값 불러오기
            </button>
          </div>
          <div className="fdc-schedule-fields">
            <label>
              예약 지연 · 초
              <input
                aria-label="예약 지연"
                type="number"
                min="0"
                max="86400"
                required
                value={delay}
                onChange={(event) => setDelay(event.target.valueAsNumber)}
              />
            </label>
            <label>
              변화 시간 · 초
              <input
                aria-label="변화 시간"
                type="number"
                min="0"
                max="86400"
                required
                value={duration}
                onChange={(event) => setDuration(event.target.valueAsNumber)}
              />
            </label>
          </div>
          <button
            type="submit"
            value="schedule"
            className="fdc-schedule-button"
          >
            스케줄에 등록
          </button>
          <p className="fdc-muted">
            가상 운전 시간 기준. 0초 변화는 즉시 적용합니다.
          </p>
        </fieldset>
      </form>
    </section>
  );
}

/** Native React control page; the surrounding route supplies a controller provider. */
export function FuelDemoControl({ theme, onPlay }: { theme?: "light" | "dark"; onPlay?: () => void }) {
  const { snapshot, catalog, status, receivedAt, serverId, command } =
    useFuelDemo();
  const [selection, setSelection] = useState<Selection>({
    op: "equipment",
    id: "cv54a",
  });
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState({ message: "", error: false });
  const disabled = status !== "online" || busy;
  const send: Send = async (next, message = "명령이 적용됐습니다.") => {
    if (busy) return;
    setBusy(true);
    try {
      await command(next);
      if (next.op === 'play') onPlay?.();
      setFeedback({ message, error: false });
    } catch (error) {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "명령을 적용하지 못했습니다.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const equipment =
    catalog?.equipment.filter(
      (item) =>
        (!group || item.group === group) &&
        `${item.code} ${item.name}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const name = (action: FuelDemoAction) =>
    action.op === 'feeder' ? `${action.id} 급탄기` : action.op === "unit"
      ? `${action.id}호기`
      : (catalog?.equipment.find((item) => item.id === action.id)?.code ??
        action.id);
  const time = snapshot ? clock(snapshot.baseTime, snapshot.elapsed) : "—";
  return (
    <section
      className="fuel-demo-control"
      data-theme={theme}
      aria-label="운전 데모 조작반"
    >
      <header className="fdc-title">
        <div>
          <h1>운전 데모 조작반</h1>
          <p>
            참고 재고를 바탕으로 한 로컬 운전 모사 · 실제 설비·ZGX 원장과 분리
          </p>
        </div>
        <span className="fdc-connection" data-status={status} role="status">
          {statusLabels[status]}
        </span>
      </header>
      {status !== "online" && (
        <p className="fdc-notice">
          {receivedAt
            ? `마지막 정상 수신 ${new Date(receivedAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} KST. 다시 연결되면 새 수신값으로 갱신합니다.`
            : "로컬 데모 서버의 첫 수신을 기다립니다. 서버 실행 후 자동으로 연결됩니다."}
        </p>
      )}
      <div className="fdc-layout">
        <aside className="fdc-clock">
          <h2>가상 운전 시계</h2>
          <time>{time}</time>
          <p>
            {snapshot
              ? `${new Date(Date.parse(snapshot.baseTime) + snapshot.elapsed * 1000).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} · KST`
              : "수신 전"}
          </p>
          <div className="fdc-playback">
            <button
              disabled={disabled || !!snapshot?.playing}
              onClick={() => void send({ op: "play" })}
            >
              재생
            </button>
            <button
              disabled={disabled || !snapshot?.playing}
              onClick={() => void send({ op: "pause" })}
            >
              일시정지
            </button>
          </div>
          <label className="fdc-field">
            시간 배속
            <select
              aria-label="시간 배속"
              value={snapshot?.speed ?? 1}
              disabled={disabled}
              onChange={(event) =>
                void send({ op: "speed", value: Number(event.target.value) })
              }
            >
              {[1, 10, 30, 60, 300, 600, 3600].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}배속
                </option>
              ))}
            </select>
          </label>
          <p>
            {snapshot
              ? `경과 ${Math.floor(snapshot.elapsed / 60)}분 ${Math.floor(snapshot.elapsed % 60)}초 · ${snapshot.playing ? "재생 중" : "일시정지"}`
              : "—"}
          </p>
          <div className="fdc-presets">
            <h2>운전 예제</h2>
            <p>
              2부두 하역·상탄, 60초 고장·90초 복구와 7호기 출력 변화를
              준비합니다.
            </p>
            <button
              disabled={disabled}
              onClick={() =>
                void send(
                  { op: "preset" },
                  "예제가 준비됐습니다. 재생을 누르세요.",
                )
              }
            >
              예제 불러오기
            </button>
            <button
              disabled={disabled}
              onClick={() =>
                void send(
                  { op: "reset" },
                  "시연 초기 재고와 운전값을 복원했습니다.",
                )
              }
            >
              초기 스냅샷 복원
            </button>
          </div>
          <p className="fdc-source">
            모의 운전 값은 별도 DB에 저장되며 재시작 후 일시정지 상태로 복원됩니다.
          </p>
        </aside>
        <div className="fdc-main">
          <p
            className="fdc-feedback"
            data-error={feedback.error}
            role={feedback.error ? "alert" : "status"}
          >
            {feedback.message}
          </p>
          {snapshot && catalog ? (
            <>
              <div className="fdc-workbench">
                <section
                  className="fdc-panel fdc-instruments"
                  aria-labelledby="fdc-equipment-heading"
                >
                  <div className="fdc-heading">
                    <h2>실물 재고 작업</h2>
                    <span>시연 기준 · t</span>
                  </div>
                  <div key={serverId}>
                    {(["unload", "reclaim"] as FuelDemoWorkKind[]).map(
                      (kind) => (
                        <WorkForm
                          key={kind}
                          kind={kind}
                          catalog={catalog}
                          snapshot={snapshot}
                          disabled={disabled}
                          send={send}
                        />
                      ),
                    )}
                  </div>
                  <SiloControl snapshot={snapshot} disabled={disabled} send={send}/>
                  <p className="fdc-mass">
                    현재 {fmt(snapshot.material.totalStock)} t = 기준{" "}
                    {fmt(snapshot.material.baselineStock)} + 하역{" "}
                    {fmt(snapshot.material.received)} − 상탄{" "}
                    {fmt(snapshot.material.outbound)} t
                  </p>
                  <div className="fdc-heading">
                    <h2 id="fdc-equipment-heading">이송 설비</h2>
                    <span>{equipment.length}개</span>
                  </div>
                  <div className="fdc-filters">
                    <label>
                      설비 검색
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="설비 코드·이름"
                      />
                    </label>
                    <label>
                      운전 구역
                      <select
                        value={group}
                        onChange={(event) => setGroup(event.target.value)}
                      >
                        <option value="">전체 구역</option>
                        {[
                          ...new Set(
                            catalog.equipment.map((item) => item.group),
                          ),
                        ].map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="fdc-table-scroll fdc-equipment-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>설비</th>
                          <th>상태</th>
                          <th className="fdc-number">이송량 · t/h</th>
                          <th className="fdc-number">위치 · %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {equipment.map((item) => {
                          const value = snapshot.equipment[item.id];
                          return (
                            <tr
                              key={item.id}
                              data-selected={
                                selection.op === "equipment" &&
                                selection.id === item.id
                              }
                            >
                              <td>
                                <button
                                  aria-label={`${item.code} 편집`}
                                  onClick={() =>
                                    setSelection({
                                      op: "equipment",
                                      id: item.id,
                                    })
                                  }
                                >
                                  {item.code}
                                  <small>{item.name}</small>
                                </button>
                              </td>
                              <td>
                                <span
                                  className="fdc-run-status"
                                  data-status={value.status}
                                >
                                  {runLabels[value.status]}
                                </span>
                              </td>
                              <td className="fdc-number">{fmt(value.flow)}</td>
                              <td className="fdc-number">
                                {["stacker", "reclaimer", "tripper"].includes(
                                  item.kind,
                                )
                                  ? fmt(value.position)
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                        {!equipment.length && (
                          <tr>
                            <td colSpan={4}>
                              검색 조건에 맞는 설비가 없습니다.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="fdc-heading fdc-unit-heading">
                    <h2>호기별 발전출력</h2>
                    <strong>
                      {fmt(
                        Object.values(snapshot.units).reduce(
                          (sum, unit) => sum + unit.mw,
                          0,
                        ),
                      )}{" "}
                      MW
                    </strong>
                  </div>
                  <div className="fdc-units">
                    {catalog.units.map((unit) => (
                      <button
                        key={unit.id}
                        aria-label={`${unit.id}호기 편집`}
                        aria-pressed={
                          selection.op === "unit" && selection.id === unit.id
                        }
                        onClick={() =>
                          setSelection({ op: "unit", id: unit.id })
                        }
                      >
                        <span>{unit.id}호기</span>
                        <b>{fmt(snapshot.units[unit.id].mw)}</b>
                        <small>MW</small>
                      </button>
                    ))}
                  </div>
                </section>
                <Editor
                  key={`${serverId}:${selection.op}:${selection.id}`}
                  selection={selection}
                  catalog={catalog}
                  snapshot={snapshot}
                  disabled={disabled}
                  send={send}
                />
              </div>
              <div className="fdc-bottom">
                <section className="fdc-panel">
                  <div className="fdc-heading">
                    <h2>운전 스케줄</h2>
                    <span>
                      대기{" "}
                      {
                        snapshot.schedule.filter(
                          (item) => item.status === "pending",
                        ).length
                      }
                      건
                    </span>
                  </div>
                  <div className="fdc-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>실행 · KST</th>
                          <th>변경 대상</th>
                          <th>변화</th>
                          <th>상태</th>
                          <th>조작</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.schedule.map((item) => (
                          <tr key={item.id}>
                            <td>{clock(snapshot.baseTime, item.at)}</td>
                            <td>
                              {name(item.action)}
                              <small>
                                {Object.entries(item.action.patch)
                                  .map(([key, value]) =>
                                    key === "status"
                                      ? runLabels[value as FuelDemoRunStatus]
                                      : `${fmt(value as number)} ${key === "mw" ? "MW" : key === "flow" ? "t/h" : "%"}`,
                                  )
                                  .join(" · ")}
                              </small>
                            </td>
                            <td>
                              {item.duration ? `${item.duration}초` : "즉시"}
                            </td>
                            <td>
                              {
                                {
                                  pending: "대기",
                                  done: "실행됨",
                                  cancelled: "취소됨",
                                  failed: "미실행",
                                }[item.status]
                              }
                            </td>
                            <td>
                              {item.status === "pending" && (
                                <button
                                  disabled={disabled}
                                  aria-label={`${name(item.action)} 예약 취소`}
                                  onClick={() =>
                                    void send(
                                      { op: "cancel", id: item.id },
                                      "예약을 취소했습니다.",
                                    )
                                  }
                                >
                                  취소
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!snapshot.schedule.length && (
                          <tr>
                            <td colSpan={5}>
                              예약이 없습니다. 운전값을 예약하거나 예제를
                              불러오세요.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="fdc-panel">
                  <div className="fdc-heading">
                    <h2>조작 이력</h2>
                    <span>최근 {snapshot.events.length}건</span>
                  </div>
                  <ol className="fdc-events">
                    {snapshot.events.map((event) => (
                      <li key={event.id}>
                        <time>{clock(snapshot.baseTime, event.at)}</time>
                        <p>{event.message}</p>
                      </li>
                    ))}
                    {!snapshot.events.length && (
                      <li>아직 조작 이력이 없습니다.</li>
                    )}
                  </ol>
                </section>
              </div>
            </>
          ) : (
            <section className="fdc-panel fdc-empty">
              <h2>데모 운전값 수신 대기</h2>
              <p>
                로컬 데모 서버가 연결되면 하역·상탄 작업, 설비·호기 편집과
                스케줄이 표시됩니다.
              </p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
