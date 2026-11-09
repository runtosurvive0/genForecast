import { useState } from "react";
import { ArrowLeft, Check, Plus, Trash2 } from "lucide-react";
import { authJson } from "@/lib/auth-client";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import type {
  Schema,
  Records,
  Row,
  Entity,
  Field,
  Preview,
} from "./VoyageRegistry";
import { visibleFields } from "./voyage-dummy";

const groups = [
  {
    title: "배선 기본정보",
    text: "연도와 부두를 선택하면 다음 항차번호를 추천합니다.",
    fields: ["classification", "status", "charter_type"],
  },
  {
    title: "항로·선적 일정",
    text: "선적항 국가와 선박 국적은 별도 정보입니다. 모든 일시는 KST입니다.",
    fields: [
      "origin_port",
      "loading_country",
      "destination_port",
      "laycan_start",
      "laycan_end",
      "laycan_status",
      "laycan_notes",
      "loading_eta",
      "loading_etb",
      "loading_etd",
    ],
  },
  {
    title: "하역 일정·노미네이션",
    text: "예정 일정과 실제 실적을 구분해서 기록합니다.",
    fields: [
      "planned_departure",
      "planned_arrival",
      "planned_berth",
      "planned_unload_end",
      "discharge_etd",
      "actual_departure",
      "actual_arrival",
      "actual_berth",
      "actual_unload_end",
      "nomination",
      "nomination_date",
    ],
  },
];
const cargoGroups = [
  [
    "coal_name",
    "supplier",
    "mine",
    "origin_country",
    "destination_plant_id",
    "planned_t",
    "bl_t",
    "bl_no",
    "receipt_date",
    "receipt_end_date",
    "received_t",
  ],
  ["contract_type", "incoterms", "contract_no", "contract_date", "notes"],
];
function clean(schema: Schema, entity: Entity, row: Row): Row {
  return Object.fromEntries(
    visibleFields(schema[entity].fields).map((f) => [f.key, row[f.key] ?? null]),
  );
}
export function VoyageEntryEditor({
  schema,
  data,
  voyage,
  interestVessels,
  onBack,
  onSaved,
}: {
  schema: Schema;
  data: Records;
  voyage: Row | null;
  interestVessels: TrackingVessel[];
  onBack: () => void;
  onSaved: (data: Records, id: string) => void;
}) {
  const [draft, setDraft] = useState<Row>(() =>
    voyage
      ? clean(schema, "voyages", { ...voyage, berth_id: voyage.berth_id || (String(voyage.voyage_number ?? '').match(/^\d{2}-([123])-\d{3}$/)?.[1] ? `BD-${String(voyage.voyage_number).split('-')[1]}` : null) })
      : {
          voyage_no: `V-${crypto.randomUUID()}`,
          status: "planned",
          plan_name: "",
          voyage_number: "",
          ship_code: null,
        },
  );
  const [ship, setShip] = useState<Row>(() =>
    clean(
      schema,
      "ships",
      data.ships.find((s) => s.ship_code === voyage?.ship_code) ?? {
        ship_code: `S-${crypto.randomUUID()}`,
      },
    ),
  );
  const [cargo, setCargo] = useState<Row[]>(() => {
    const old = data.cargo
      .filter((c) => c.voyage_no === voyage?.voyage_no)
      .map((c) => clean(schema, "cargo", c));
    return old.length
      ? old
      : [
          {
            cargo_no: `C-${crypto.randomUUID()}`,
            destination_plant_id: "dangjin",
          },
        ];
  });
  const [review, setReview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const initialNumber = String(voyage?.voyage_number ?? "").match(/^(\d{2})-([123])-(\d{3})$/);
  const [numberYear, setNumberYear] = useState(initialNumber?.[1] ?? new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: '2-digit' }).format(new Date()));
  const [numberSerial, setNumberSerial] = useState(initialNumber ? String(Number(initialNumber[3])) : '');
  const recommended = (year: string, berth: string) => {
    const used = data.voyages.filter(v => v.voyage_no !== draft.voyage_no).map(v => String(v.voyage_number ?? '').match(/^(\d{2})-([123])-(\d{3})$/)).filter(m => m && m[1] === year && m[2] === berth).map(m => Number(m![3]));
    return Math.max(0, ...used) + 1;
  };
  const updateNumber = (year: string, berth: string, serial: string) => {
    const valid = /^\d{2}$/.test(year) && /^[123]$/.test(berth) && /^\d{1,3}$/.test(serial) && Number(serial) >= 1 && Number(serial) <= 999;
    setDirty(true);
    setDraft(prev => ({ ...prev, berth_id: berth ? `BD-${berth}` : null, voyage_number: valid ? `${year}-${berth}-${serial.padStart(3, '0')}` : '' }));
  };
  const [shipMode, setShipMode] = useState(
    voyage?.ship_code ? String(voyage.ship_code) : "",
  );
  const update = (key: string, value: string) => {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };
  const field = (entity: Entity, key: string) =>
    schema[entity].fields.find((f) => f.key === key)!;
  function input(
    f: Field,
    row: Row,
    change: (key: string, value: string) => void,
    suggestions?: string[],
  ) {
    const value = row[f.key] ?? "";
    const label = f.label + (f.required ? " *" : "");
    return (
      <label key={f.key} className={f.kind === "memo" ? "ve-wide" : ""}>
        {label}
        {f.choices ? (
          <select
            aria-label={label}
            value={String(value)}
            disabled={busy}
            onChange={(e) => change(f.key, e.target.value)}
            required={f.required}
          >
            <option value="">미정</option>
            {Object.entries(f.choices).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        ) : f.kind === "memo" ? (
          <textarea
            aria-label={label}
            value={value}
            disabled={busy}
            rows={2}
            maxLength={2000}
            onChange={(e) => change(f.key, e.target.value)}
          />
        ) : (
          <>
            <input
              aria-label={label}
              value={f.kind === "datetime" ? String(value).slice(0, 16) : value}
              disabled={busy}
              type={
                f.kind === "datetime"
                  ? "datetime-local"
                  : f.kind === "date"
                    ? "date"
                    : f.kind === "number"
                      ? "number"
                      : "text"
              }
              min={f.min}
              max={f.max}
              step={f.kind === "number" ? "any" : undefined}
              maxLength={f.digits ?? 200}
              required={
                f.required &&
                (f.key !== "coal_name" ||
                  Object.entries(row).some(
                    ([k, v]) =>
                      !["cargo_no", "destination_plant_id"].includes(k) &&
                      v !== null &&
                      v !== "",
                  ))
              }
              placeholder={
                f.key === "voyage_number" ? "예: 26-1-019 또는 1-19" : undefined
              }
              list={suggestions?.length ? `ve-${f.key}` : undefined}
              onChange={(e) => change(f.key, e.target.value)}
            />
            {suggestions?.length ? (
              <datalist id={`ve-${f.key}`}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            ) : null}
          </>
        )}
        {f.key === "voyage_number" && (
          <small>연도 · 부두 · 입항 순번 / 미정이면 비워 두세요.</small>
        )}
        {f.key === "receipt_date" && <small>석탄이 들어온 날짜</small>}
      </label>
    );
  }
  function changes() {
    const shipUsed = shipMode !== "";
    return {
      voyages: [
        clean(schema, "voyages", {
          ...draft,
          ship_code: shipUsed ? ship.ship_code : null,
        }),
      ],
      ships: shipUsed ? [clean(schema, "ships", ship)] : [],
      cargo: cargo
        .filter(
          (c) =>
            data.cargo.some((old) => old.cargo_no === c.cargo_no) ||
            Object.entries(c).some(
              ([k, v]) =>
                !["cargo_no", "destination_plant_id"].includes(k) &&
                v !== null &&
                v !== "",
            ),
        )
        .map((c) =>
          clean(schema, "cargo", { ...c, voyage_no: draft.voyage_no }),
        ),
    };
  }
  async function preview() {
    setBusy(true);
    setError("");
    try {
      if (numberSerial && !draft.voyage_number)
        throw new Error("연도, 부두와 1~999 사이 일련번호를 확인하세요.");
      if (draft.voyage_number && data.voyages.some(v => v.voyage_no !== draft.voyage_no && v.voyage_number === draft.voyage_number))
        throw new Error("이미 사용 중인 항차번호입니다. 다른 일련번호를 선택하세요.");
      const result = await authJson<Preview>("/api/voyage-registry/preview", {
        method: "POST",
        body: JSON.stringify({ changes: changes() }),
      });
      if (result.revision !== data.revision)
        throw new Error(
          "편집 중 다른 변경이 저장되었습니다. 원장을 새로 조회한 뒤 변경 내용을 확인해 주세요.",
        );
      setReview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검토하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!review || review.errors.length || !review.changes.length) return;
    setBusy(true);
    setError("");
    try {
      const saved = await authJson<Records>("/api/voyage-registry/commit", {
        method: "POST",
        body: JSON.stringify({ changes: changes(), revision: review.revision }),
      });
      onSaved(saved, String(draft.voyage_no));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "저장하지 못했습니다. 입력 내용을 유지합니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  const suggestions = (entity: Entity, key: string) => [
    ...new Set(data[entity].map((r) => String(r[key] ?? "")).filter(Boolean)),
  ];
  return (
    <section className="vr-workspace ve-workspace" aria-label="배선 입력">
      <header className="vr-heading">
        <div>
          <button
            className="vr-back"
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "저장하지 않은 입력이 있습니다. 원장으로 돌아갈까요?",
                )
              )
                onBack();
            }}
          >
            <ArrowLeft size={16} />
            배선 원장
          </button>
          <h1>{voyage ? "배선 수정" : "배선 등록"}</h1>
        </div>
        <span className="ve-caption">선박 미정 등록 가능 · 팀 공동 편집</span>
      </header>
      {error && (
        <p className="vr-error" role="alert">
          {error}
        </p>
      )}
      {review ? (
        <div className="ve-scroll">
          <h2>변경 내용 확인</h2>
          <p>
            추가 {review.counts.create}건 · 수정 {review.counts.update}건 · 오류{" "}
            {review.errors.length}건
          </p>
          {!!review.errors.length && (
            <div className="vr-validation" role="alert">
              {review.errors.map((e, i) => (
                <p key={i}>
                  {e.sheet} {e.row}행 · {e.column}: {e.message}
                </p>
              ))}
            </div>
          )}
          {review.changes.map((c) => (
            <details key={`${c.entity}-${c.key}`} className="vr-change" open>
              <summary>
                {c.sheet} ·{" "}
                {String(
                  c.after.voyage_number ||
                    c.after.plan_name ||
                    c.after.coal_name ||
                    c.after.name ||
                    c.key,
                )}{" "}
                · {c.action === "create" ? "추가" : "수정"}
              </summary>
              <dl>
                {visibleFields(schema[c.entity].fields)
                  .filter(
                    (f) =>
                      f.key !== schema[c.entity].key &&
                      c.before?.[f.key] !== c.after[f.key],
                  )
                  .map((f) => (
                    <div key={f.key}>
                      <dt>{f.label}</dt>
                      <dd>
                        <del>{String(c.before?.[f.key] ?? "—")}</del> →{" "}
                        <strong>
                          {f.choices?.[String(c.after[f.key])] ??
                            String(c.after[f.key] ?? "—")}
                        </strong>
                      </dd>
                    </div>
                  ))}
              </dl>
            </details>
          ))}
        </div>
      ) : (
        <form
          id="ve-form"
          className="ve-scroll"
          onSubmit={(e) => {
            e.preventDefault();
            void preview();
          }}
        >
          <div className="ve-layout">
            <div className="ve-main">
              <section className="ve-section">
                <h2>투입 선박</h2>
                <p>
                  관심 선박이나 공용 원장에서 선택하거나 새로 입력합니다. IMO·MMSI는 아는
                  번호만 입력하세요.
                </p>
                <div className="ve-fields">
                  <label className="ve-wide">
                    선박 연결
                    <select
                      aria-label="선박 연결"
                      disabled={busy}
                      value={shipMode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        if (mode.startsWith('interest:')) {
                          const vessel = interestVessels.find(v => v.id === mode.slice(9));
                          if (!vessel) return;
                          const matching = data.ships.filter(s =>
                            (vessel.mmsi && s.mmsi === vessel.mmsi) ||
                            (vessel.imo && s.imo === vessel.imo));
                          if (matching.length > 1 || (matching[0] &&
                            ((vessel.mmsi && matching[0].mmsi && vessel.mmsi !== matching[0].mmsi) ||
                             (vessel.imo && matching[0].imo && vessel.imo !== matching[0].imo)))) {
                            setError('관심 선박과 공용 선박의 식별번호가 일치하지 않습니다. 선박 원장을 확인해 주세요.');
                            return;
                          }
                          setError('');
                          setShipMode(mode);
                          setDirty(true);
                          setShip(clean(schema, 'ships', matching[0] ?? {
                            ship_code: `S-${crypto.randomUUID()}`, name: vessel.name,
                            mmsi: vessel.mmsi || null, imo: vessel.imo || null,
                          }));
                          return;
                        }
                        setError('');
                        setShipMode(mode);
                        setDirty(true);
                        setShip(
                          clean(
                            schema,
                            "ships",
                            data.ships.find((s) => s.ship_code === mode) ?? {
                              ship_code: `S-${crypto.randomUUID()}`,
                            },
                          ),
                        );
                      }}
                    >
                      <option value="">선박 미정</option>
                      <option value="new">새 선박 입력</option>
                      {interestVessels.length > 0 && <optgroup label="관심 선박">{interestVessels.map(v => (
                        <option key={v.id} value={`interest:${v.id}`}>{v.name}{v.mmsi ? ` · MMSI ${v.mmsi}` : v.imo ? ` · IMO ${v.imo}` : ''}</option>
                      ))}</optgroup>}
                      {data.ships.length > 0 && <optgroup label="공용 선박 원장">{data.ships.map((s) => (
                        <option
                          key={String(s.ship_code)}
                          value={String(s.ship_code)}
                        >
                          {s.name}{" "}
                          {s.imo
                            ? `· IMO ${s.imo}`
                            : s.mmsi
                              ? `· MMSI ${s.mmsi}`
                              : ""}
                        </option>
                      ))}</optgroup>}
                    </select>
                  </label>
                  {shipMode &&
                    ["name", "imo", "mmsi", "operator", "flag"].map((k) =>
                      input(field("ships", k), ship, (key, v) => {
                        setDirty(true);
                        setShip((prev) => ({ ...prev, [key]: v }));
                      }),
                    )}
                </div>
                {shipMode && (
                  <small>
                    관심 선박은 저장 시 공용 원장과 연결됩니다. 선박 정보
                    수정은 연결된 항차에 공통 적용됩니다.
                  </small>
                )}
                {shipMode.startsWith('interest:') && !ship.mmsi && !ship.imo && (
                  <small>
                    식별번호가 없어 기존 선박과 자동 비교할 수 없습니다. 같은 선박이 있다면 공용 선박 원장에서 선택해 주세요.
                  </small>
                )}
              </section>
              <section className="ve-section">
                <h2>{groups[0].title}</h2>
                <p>{groups[0].text}</p>
                <div className="ve-fields">
                  {groups[0].fields.filter(k => schema.voyages.fields.some(f => f.key === k)).map((k) =>
                    input(field("voyages", k), draft, update),
                  )}
                  {input(field("voyages", "yard"), draft, update)}
                  <label>연도 (YY)<input aria-label="항차 연도" inputMode="numeric" maxLength={2} disabled={busy} value={numberYear} onChange={e => { const year = e.target.value.replace(/\D/g, '').slice(0, 2); const berth = String(draft.berth_id ?? '').replace('BD-', ''); setNumberYear(year); const next = year.length === 2 && berth ? String(recommended(year, berth)) : ''; setNumberSerial(next); updateNumber(year, berth, next); }} /></label>
                  <label>접안부두<select aria-label="접안부두" disabled={busy} value={String(draft.berth_id ?? '')} onChange={e => { const berth = e.target.value.replace('BD-', ''); const next = berth && numberYear.length === 2 ? String(recommended(numberYear, berth)) : ''; setNumberSerial(next); updateNumber(numberYear, berth, next); }}><option value="">미정</option><option value="BD-1">1부두</option><option value="BD-2">2부두</option><option value="BD-3">3부두</option></select></label>
                  <label>일련번호<input aria-label="항차 일련번호" type="number" min="1" max="999" disabled={busy} value={numberSerial} onChange={e => { setNumberSerial(e.target.value); updateNumber(numberYear, String(draft.berth_id ?? '').replace('BD-', ''), e.target.value); }} /><small>같은 연도·부두의 마지막 등록 번호 다음을 추천합니다.</small></label>
                  <label>항차번호<input aria-label="항차번호" readOnly value={String(draft.voyage_number ?? '')} placeholder="연도와 부두를 선택하세요" /><small>번호 미정 계획은 일련번호를 비워 저장할 수 있습니다.</small></label>
                </div>
              </section>
              {groups.slice(1).map((group) => (
                <section className="ve-section" key={group.title}>
                  <h2>{group.title}</h2>
                  <p>{group.text}</p>
                  <div className="ve-fields">
                    {group.fields.map((k) =>
                      input(
                        field("voyages", k),
                        draft,
                        update,
                        [
                          "origin_port",
                          "destination_port",
                          "loading_country",
                        ].includes(k)
                          ? suggestions("voyages", k)
                          : undefined,
                      ),
                    )}
                  </div>
                </section>
              ))}
              <section className="ve-section">
                <h2>배선 메모</h2>
                <div className="ve-fields">
                  {input({ ...field("voyages", "notes"), label: "배선 메모" }, draft, update)}
                </div>
              </section>
            </div>
            <aside className="ve-cargo">
              <header className="vr-panel-title">
                <h2>화물·계약</h2>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDirty(true);
                    setCargo((prev) => [
                      ...prev,
                      {
                        cargo_no: `C-${crypto.randomUUID()}`,
                        destination_plant_id: "dangjin",
                      },
                    ]);
                  }}
                >
                  <Plus size={16} />
                  화물 추가
                </button>
              </header>
              <p className="ve-caption">
                같은 배선의 공급사·계약·탄종별로 추가하세요. 성상은 저장 후 분석
                원장에서 관리합니다.
              </p>
              {cargo.map((c, i) => (
                <section className="ve-cargo-item" key={String(c.cargo_no)}>
                  <header>
                    <h3>
                      화물 {i + 1}
                      {c.coal_name ? ` · ${c.coal_name}` : ""}
                    </h3>
                    {!data.cargo.some((old) => old.cargo_no === c.cargo_no) && (
                      <button
                        type="button"
                        aria-label={`화물 ${i + 1} 입력 제거`}
                        disabled={busy}
                        onClick={() => {
                          setDirty(true);
                          setCargo((prev) => prev.filter((_, n) => n !== i));
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </header>
                  {cargoGroups.map((keys, n) => (
                    <div key={n} className="ve-fields">
                      {keys.map((k) =>
                        input(field("cargo", k), c, (key, v) => {
                          setDirty(true);
                          setCargo((prev) =>
                            prev.map((item, index) =>
                              index === i ? { ...item, [key]: v } : item,
                            ),
                          );
                        }),
                      )}
                    </div>
                  ))}
                  <small>
                    예정물량 또는 B/L물량 중 하나를 입력하세요. 미확인은 빈칸,
                    확정된 0은 0입니다.
                  </small>
                </section>
              ))}
            </aside>
          </div>
        </form>
      )}
      <footer className="ve-footer">
        <span>
          {review
            ? "변경 전후를 확인한 뒤 공용 원장에 반영하세요."
            : "입력만으로 저탄 재고가 변경되지는 않습니다."}
        </span>
        <div className="vr-actions">
          {review ? (
            <>
              <button disabled={busy} onClick={() => setReview(null)}>
                입력으로 돌아가기
              </button>
              <button
                className="vr-primary"
                disabled={
                  busy || !!review.errors.length || !review.changes.length
                }
                onClick={() => void save()}
              >
                <Check size={16} />
                공용 원장에 반영
              </button>
            </>
          ) : (
            <button
              className="vr-primary"
              type="submit"
              form="ve-form"
              disabled={busy}
            >
              변경 내용 확인
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
