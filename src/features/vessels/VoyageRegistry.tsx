import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { Dialog } from "radix-ui";
import {
  ArrowRight,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  History,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Ship,
  X,
  FlaskConical,
} from "lucide-react";
import { authJson } from "@/lib/auth-client";
import { useAccount } from "@/lib/account-context";
import "./voyage-registry.css";
import { VoyageEntryEditor } from "./VoyageEntryEditor";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import { InventoryWorkspace } from "@/components/inventory/InventoryWorkspace";
import {
  DUMMY_FIELD_TITLE,
  DUMMY_ROW_TITLE,
  auditOriginLabel,
  dummyFieldKeys,
  dummyRowTitle,
  isDummyRow,
  parseAuditRow,
  visibleFields,
} from "./voyage-dummy";

export type Entity = "ships" | "voyages" | "cargo" | "assays";
export type Row = Record<string, string | number | null>;
export interface Field {
  key: string;
  label: string;
  kind: string;
  required: boolean;
  choices?: Record<string, string>;
  reference?: Entity;
  min?: number;
  max?: number;
  digits?: number;
  group?: string;
  /** 서버가 관리하는 칸(더미 구분 등). 편집기·상세 목록에 보이지 않는다. */
  system?: boolean;
}
export type Schema = Record<
  Entity,
  { label: string; key: string; fields: Field[] }
>;
interface Audit {
  id: number;
  entity: Entity;
  record_key: string;
  origin: string;
  at: string;
  actor: string;
  revision: number;
  before_json: string | null;
  after_json: string;
}
export type Records = Record<Entity, Row[]> & {
  revision: number;
  audit: Audit[];
  quality_selection: Record<
    string,
    | (Row & {
        missing: string[];
        derived_ash_db: number | null;
        ncv_usable: boolean;
      })
    | null
  >;
};
interface Change {
  entity: Entity;
  sheet: string;
  row: number;
  key: string;
  action: "create" | "update";
  before: Row | null;
  after: Row;
}
export interface Preview {
  revision: number;
  changes: Change[];
  counts: { create: number; update: number };
  unchanged: number;
  errors: { sheet: string; row: number; column: string; message: string }[];
  file_digest?: string;
  stale_workbook?: boolean;
  source_revision?: number;
}
const base = "/api/voyage-registry";
const entities: Entity[] = ["voyages", "cargo", "assays", "ships"];
const icons = {
  ships: Ship,
  voyages: Database,
  cargo: Package,
  assays: FlaskConical,
};
const names = {
  ships: "선박 관리",
  voyages: "배선 원장",
  cargo: "화물 원장",
  assays: "성상 분석",
};
const assayGroups = [
  "분석 정보",
  "발열량·기본 성상",
  "공업분석 · ADB, %wt",
  "원소분석 · DB, %wt",
  "회성분 분석 · %wt",
  "연료특성",
  "회융점 · 환원성, °C",
  "입도·염소·점결성",
  "기존 성상값",
];
const columns: Record<Entity, string[]> = {
  ships: ["name", "mmsi", "imo", "operator"],
  voyages: [
    "voyage_number",
    "classification",
    "notes",
    "ship_code",
    "status",
    "origin_port",
    "destination_port",
    "planned_arrival",
  ],
  cargo: [
    "coal_name",
    "voyage_no",
    "origin_country",
    "receipt_date",
    "receipt_end_date",
    "received_t",
    "planned_t",
    "bl_t",
  ],
  assays: [
    "cargo_no",
    "stage",
    "analysis_date",
    "gcv_arb",
    "tm_ar",
    "sulfur_ar",
    "result_status",
  ],
};
function display(value: Row[string], field?: Field): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field?.choices) return field.choices[String(value)] ?? String(value);
  if (field?.kind === "datetime")
    return String(value).slice(0, 16).replace("T", " ");
  return typeof value === "number"
    ? value.toLocaleString("ko-KR", { maximumFractionDigits: 3 })
    : value;
}
function DummyBadge({ field = false, row }: { field?: boolean; row?: Row }) {
  return (
    <span
      className="vr-dummy-badge"
      title={field ? DUMMY_FIELD_TITLE : row ? dummyRowTitle(row) : DUMMY_ROW_TITLE}
    >
      더미
    </span>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
async function fileRequest(
  path: string,
  file: File,
): Promise<Preview | Records> {
  const response = await fetch(base + path, {
    method: "POST",
    body: file,
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
  const value = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof value?.detail === "string"
        ? value.detail
        : "엑셀 요청에 실패했습니다. 파일 형식과 서버 연결을 확인하세요.",
    );
  return value;
}

function QualitySummary({
  data,
  cargoId,
  fields,
}: {
  data: Records;
  cargoId: string;
  fields: Field[];
}) {
  const selected = data.quality_selection?.[cargoId];
  const analyses = data.assays
    .filter((a) => a.cargo_no === cargoId)
    .sort(
      (a, b) =>
        String(b.analysis_date ?? "").localeCompare(
          String(a.analysis_date ?? ""),
        ) ||
        String(b.sample_date ?? "").localeCompare(
          String(a.sample_date ?? ""),
        ) ||
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) ||
        String(b.assay_id).localeCompare(String(a.assay_id)),
    );
  const stages = [
    ["loading", "선적"],
    ["unloading", "하역"],
    ["buyer", "바이어"],
  ];
  return (
    <section className="vr-quality">
      <h3>
        대표 성상 ·{" "}
        {selected
          ? selected.stage === "unloading"
            ? "하역"
            : "선적"
          : "미등록"}
      </h3>
      <p>확정 하역 분석 우선 · 없으면 선적 분석</p>
      <div className="vr-quality-scroll">
        <table>
          <thead>
            <tr>
              <th>항목</th>
              {stages.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["gcv_arb", "발열량 ARB"],
              ["tm_ar", "총수분 AR"],
              ["sulfur_ar", "유황분 AR"],
            ].map(([key, label]) => (
              <tr key={key}>
                <th>{label}</th>
                {stages.map(([stage]) => {
                  const a = analyses.find(
                    (a) => a.stage === stage && a.result_status === "confirmed",
                  );
                  return (
                    <td key={stage}>
                      {display(a?.[key] ?? null)}
                      {a && dummyFieldKeys(a, fields, "assay_id").has(key) && (
                        <DummyBadge field />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <>
          <p>
            선택 분석:{" "}
            {String(
              selected.report_no ||
                selected.sample_no ||
                selected.analysis_date ||
                "날짜 미등록",
            )}
          </p>
          <p>
            Ash(DB):{" "}
            {selected.derived_ash_db === null
              ? "계산 자료 부족"
              : `${Number(selected.derived_ash_db).toFixed(3)} %wt`}{" "}
            · 공업분석에서 환산
          </p>
          {selected.ncv !== null && !selected.ncv_usable && (
            <p>NCV 기준 미확인 · 계산 제외</p>
          )}
          {!!selected.missing.length && (
            <p>
              기본 성상 {selected.missing.length}개 미등록 · 다른 분석으로
              채우지 않습니다.
            </p>
          )}
        </>
      )}
      <small>
        동일 구분은 분석일·채취일·수정시각 순으로 선택합니다. 바이어 샘플은
        비교용입니다.
      </small>
    </section>
  );
}

export function VoyageRegistry({ navigation, initialEntity = 'voyages', initialKey = '', interestVessels = [] }: { navigation?: ReactNode; initialEntity?: Entity; initialKey?: string; interestVessels?: TrackingVessel[] }) {
  const account = useAccount();
  const writable = account?.user.status === "active";
  const [schema, setSchema] = useState<Schema | null>(null);
  const [data, setData] = useState<Records | null>(null);
  const [entity, setEntity] = useState<Entity>(initialEntity);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assayGroup, setAssayGroup] = useState("발열량·기본 성상");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [entry, setEntry] = useState<{ voyage: Row | null } | null>(null);
  const [selected, setSelected] = useState(initialKey);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    entity: Entity;
    key: string | null;
    draft: Row;
    revision: number;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<Preview | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [history, setHistory] = useState(false);
  const [inventoryView, setInventoryView] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    Promise.all([
      authJson<Schema>(base + "/schema", { signal: abort.signal }),
      authJson<Records>(base + "/records", { signal: abort.signal }),
    ])
      .then(([s, d]) => {
        setSchema(s);
        setData(d);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            message(e) + " ZGX에 항차 DB API가 적용되어 있는지 확인해 주세요.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, []);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const [s, d] = await Promise.all([
        authJson<Schema>(base + "/schema"),
        authJson<Records>(base + "/records"),
      ]);
      setSchema(s);
      setData(d);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(template: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        base + (template ? "/template" : "/export"),
        { signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok)
        throw new Error(
          "엑셀 파일을 내려받지 못했습니다. 서버 연결을 확인하세요.",
        );
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = template
        ? "gen4cast-voyage-template.xlsx"
        : `gen4cast-voyages-r${data?.revision}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function openEditor(key: string | null) {
    if (!schema || !data) return;
    const existing = data[entity].find((r) => r[schema[entity].key] === key);
    if (entity === "voyages") {
      setEntry({ voyage: existing ?? null });
      return;
    }
    const draft = Object.fromEntries(
      visibleFields(schema[entity].fields).map((f) => [
        f.key,
        existing?.[f.key] ??
          (f.key === schema[entity].key
            ? `${entity[0].toUpperCase()}-${crypto.randomUUID()}`
            : f.key === "result_status"
              ? "draft"
              : f.key === "ncv_basis"
                ? "unknown"
                : f.key === "status"
                  ? "planned"
                  : ""),
      ]),
    );
    setEditing({ entity, key, draft, revision: data.revision });
    setReview(null);
    setFile(null);
    setDialogError("");
  }
  function closeEditor() {
    if (!busy) {
      setEditing(null);
      setFile(null);
      setReview(null);
      setDialogError("");
    }
  }
  async function previewManual() {
    if (!editing) return;
    setBusy(true);
    setDialogError("");
    try {
      const value = await authJson<Preview>(base + "/preview", {
        method: "POST",
        body: JSON.stringify({
          changes: { [editing.entity]: [editing.draft] },
        }),
      });
      if (value.revision !== editing.revision)
        throw new Error(
          "편집 중 공용 원장이 변경되었습니다. 입력 내용을 확인한 뒤 닫고 새로고침하여 다시 편집해 주세요.",
        );
      setReview(value);
    } catch (e) {
      setDialogError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(next: File) {
    if (
      next.size > 4 * 1024 * 1024 ||
      !next.name.toLowerCase().endsWith(".xlsx")
    ) {
      setError("4MB 이하의 .xlsx 파일을 선택하세요.");
      return;
    }
    setFile(next);
    setEditing(null);
    setReview(null);
    setAcknowledged(false);
    setDialogError("");
    setBusy(true);
    try {
      setReview((await fileRequest("/excel/preview", next)) as Preview);
    } catch (e) {
      setDialogError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!review || review.errors.length || !review.changes.length) return;
    setBusy(true);
    setDialogError("");
    try {
      const saved = file
        ? ((await fileRequest(
            `/excel/commit?${new URLSearchParams({ revision: String(review.revision), file_digest: review.file_digest!, acknowledge_stale: String(acknowledged) })}`,
            file,
          )) as Records)
        : await authJson<Records>(base + "/commit", {
            method: "POST",
            body: JSON.stringify({
              revision: review.revision,
              changes: { [editing!.entity]: [editing!.draft] },
            }),
          });
      setData(saved);
      setNotice(
        `${review.counts.create}건 추가 · ${review.counts.update}건 수정했습니다. 공용 원장 v${saved.revision}`,
      );
      if (editing)
        setSelected(String(editing.draft[schema![editing.entity].key]));
      setEditing(null);
      setFile(null);
      setReview(null);
      setError("");
    } catch (e) {
      setDialogError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function referenceLabel(target: Entity, value: Row[string]): string {
    const record = data?.[target].find((r) => r[schema![target].key] === value);
    if (!record) return value ? String(value) : "미정";
    if (target === "ships") return String(record.name);
    if (target === "voyages")
      return String(record.voyage_number || record.plan_name || record.notes || "번호 미정");
    if (target === "cargo")
      return `${referenceLabel("voyages", record.voyage_no)} · ${record.coal_name}`;
    return String(record.sample_no || record.report_no || "분석");
  }
  if (entry && schema && data)
    return (
      <VoyageEntryEditor
        schema={schema}
        data={data}
        voyage={entry.voyage}
        interestVessels={interestVessels}
        onBack={() => setEntry(null)}
        onSaved={(saved, id) => {
          setData(saved);
          setEntry(null);
          setEntity("voyages");
          setSelected(id);
          setNotice("배선과 연결 화물을 저장했습니다.");
        }}
      />
    );
  const spec = schema?.[entity];
  const visibleColumns =
    entity === "assays"
      ? [
          "cargo_no",
          "origin_country",
          "receipt_date",
          "receipt_end_date",
          "received_t",
          "stage",
          "analysis_date",
          ...(schema?.assays.fields
            .filter((f) => f.group === assayGroup)
            .map((f) => f.key) ?? []),
          ...(assayGroup === "원소분석 · DB, %wt" ? ["derived_ash_db"] : []),
        ]
      : columns[entity].filter(key => schema?.[entity].fields.some(field => field.key === key));
  const cellValue = (row: Row, key: string): Row[string] => {
    if (
      entity === "assays" &&
      [
        "origin_country",
        "receipt_date",
        "receipt_end_date",
        "received_t",
      ].includes(key)
    )
      return (
        data?.cargo.find((c) => c.cargo_no === row.cargo_no)?.[key] ?? null
      );
    if (key === "derived_ash_db")
      return row.ash_adb != null &&
        row.im_adb != null &&
        Number(row.im_adb) < 100
        ? (Number(row.ash_adb) * 100) / (100 - Number(row.im_adb))
        : null;
    return row[key];
  };
  const rows =
    data?.[entity].filter((r) => {
      const voyage =
        entity === "voyages"
          ? r
          : data.voyages.find(
              (v) =>
                v.voyage_no ===
                (entity === "cargo"
                  ? r.voyage_no
                  : data.cargo.find((c) => c.cargo_no === r.cargo_no)
                      ?.voyage_no),
            );
      const related =
        entity === "voyages"
          ? data.cargo.filter((c) => c.voyage_no === r.voyage_no)
          : entity === "assays"
            ? data.cargo.filter((c) => c.cargo_no === r.cargo_no)
            : [];
      const at = String(
        entity === "assays"
          ? r.analysis_date || ""
          : entity === "cargo"
            ? r.receipt_date || ""
            : voyage?.planned_arrival || voyage?.laycan_start || "",
      ).slice(0, 10);
      return (
        (!statusFilter ||
          (entity === "assays" ? r.stage : r.status) === statusFilter) &&
        (!dateFrom || (at && at >= dateFrom)) &&
        (!dateTo || (at && at <= dateTo)) &&
        [
          ...Object.values(r),
          ...Object.values(voyage ?? {}),
          ...related.flatMap((c) => Object.values(c)),
          data.ships.find((s) => s.ship_code === voyage?.ship_code)?.name,
        ].some(
          (v) =>
            v !== null &&
            v !== undefined &&
            String(v).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )
      );
    }) ?? [];
  const selectedRow = rows.find((r) => r[spec?.key ?? ""] === selected) ??
    (initialKey && selected === initialKey ? undefined : rows[0]);
  const fieldFor = (key: string) =>
    (entity === "voyages" && key === "notes" ? { ...spec!.fields.find(f => f.key === key)!, label: "배선 메모" } : undefined) ??
    spec?.fields.find((f) => f.key === key) ??
    schema?.cargo.fields.find((f) => f.key === key) ??
    (key === "derived_ash_db"
      ? { key, label: "Ash DB(%wt) · 계산", kind: "number", required: false }
      : undefined);
  const dialogOpen = !!editing || !!file;
  const hasFilters = Boolean(query.trim() || statusFilter || dateFrom || dateTo);
  const resetFilters = () => {
    setQuery("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };
  if (inventoryView) return <InventoryWorkspace mode="inventory" onBack={() => setInventoryView(false)} />;
  return (
    <section className="vr-workspace" aria-label="공용 항차 DB">
      {navigation}
      <header className="vr-heading">
        <div>
          <h2>
            항차·화물 원장 <span>공용 원장</span>
          </h2>
        </div>
        <div className="vr-actions">
          <button onClick={() => setInventoryView(true)}>Pile 재고</button>
          <button disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={15} /> 새로고침
          </button>
          <button disabled={busy || !data} onClick={() => void download(true)}>
            <FileSpreadsheet size={16} /> 엑셀 양식
          </button>
          <button disabled={busy || !data} onClick={() => void download(false)}>
            <Download size={16} /> 전체 내보내기
          </button>
        </div>
      </header>
      <div className="vr-context">
        <span>
          배선 계획 <span aria-hidden="true">·</span> 화물·입고 <span aria-hidden="true">·</span> 성상 분석
        </span>
        <span>
          {writable ? "팀 공동 편집" : "조회 권한"} · 일시 KST · 물량 t
          {data && ` · v${data.revision}`}
        </span>
      </div>
      {error && (
        <p role="alert" className="vr-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="vr-notice">
          <Check size={15} />
          {notice}
        </p>
      )}
      {busy && !data && <ProcessingOrb state="searching" label="공용 원장을 불러오는 중" />}
      {schema && data && (
        <>
          <div className="vr-toolbar">
            <div className="vr-tabs" role="tablist" aria-label="원장 종류">
              {entities.map((e) => {
                const Icon = icons[e];
                return (
                  <button
                    key={e}
                    role="tab"
                    aria-selected={e === entity}
                    onClick={() => {
                      setEntity(e);
                      setSelected("");
                      setQuery("");
                      setStatusFilter("");
                      setDateFrom("");
                      setDateTo("");
                    }}
                  >
                    <Icon size={17} />
                    {names[e]}
                    <span>{data[e].length}</span>
                  </button>
                );
              })}
            </div>
            <label className="vr-search">
              <Search size={16} />
              <input
                aria-label="원장 검색"
                placeholder="항차·계획·선박·공급사·계약 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {writable && (
              <div className="vr-actions">
                <button disabled={busy} onClick={() => upload.current?.click()}>
                  <FileSpreadsheet size={16} /> 엑셀 가져오기
                </button>
                <button
                  className="vr-primary"
                  disabled={busy}
                  onClick={() => openEditor(null)}
                >
                  <Plus size={16} />{" "}
                  {entity === "voyages" ? "배선" : spec!.label} 등록
                </button>
              </div>
            )}
            <input
              ref={upload}
              type="file"
              accept=".xlsx"
              aria-label="엑셀 원장 파일"
              className="sr-only"
              onChange={(e) => {
                const next = e.target.files?.[0];
                e.target.value = "";
                if (next) void importFile(next);
              }}
            />
          </div>
          <div className="vr-filters">
            {entity === "assays" && (
              <label>
                분석 항목
                <select
                  aria-label="분석 항목 보기"
                  value={assayGroup}
                  onChange={(e) => setAssayGroup(e.target.value)}
                >
                  {assayGroups
                    .filter((g) => !["분석 정보", "기존 성상값"].includes(g))
                    .map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                </select>
              </label>
            )}
            {(entity === "voyages" || entity === "assays") && (
              <label>
                {entity === "voyages" ? "진행상태" : "분석구분"}
                <select
                  aria-label="원장 상태 필터"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">전체</option>
                  {Object.entries(
                    schema[entity].fields.find(
                      (f) =>
                        f.key === (entity === "voyages" ? "status" : "stage"),
                    )!.choices!,
                  ).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {entity !== "ships" && (
              <>
                <label>
                  {entity === "assays"
                    ? "분석일"
                    : entity === "cargo"
                      ? "입고 시작일"
                      : "입항 예정일 / 미정 시 LAYCAN"}
                  <input
                    type="date"
                    aria-label="조회 시작일"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </label>
                <label>
                  종료
                  <input
                    type="date"
                    aria-label="조회 종료일"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </label>
              </>
            )}
            {hasFilters && (
              <button onClick={resetFilters}>
                조건 초기화
              </button>
            )}
          </div>
          <div className="vr-body">
            <div className="vr-table-panel">
              <div className="vr-panel-title">
                <h2>{spec!.label} 목록</h2>
                <span>
                  {rows.length}건 {hasFilters && `/ 전체 ${data[entity].length}건`}
                </span>
              </div>
              <div className="vr-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {visibleColumns.map((key) => (
                        <th key={key}>{fieldFor(key)?.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={String(row[spec!.key])}
                        data-selected={row === selectedRow}
                        onClick={() => setSelected(String(row[spec!.key]))}
                      >
                        {visibleColumns.map((key, i) => (
                          <td
                            key={key}
                            className={
                              fieldFor(key)?.kind === "number"
                                ? "vr-number"
                                : ""
                            }
                          >
                            {i === 0 ? (
                              <>
                                <button
                                  className="vr-record-link"
                                  aria-label={`${fieldFor(key)?.reference ? referenceLabel(fieldFor(key)!.reference!, row[key]) : row[key] || row.plan_name || "번호 미정"} 상세 보기`}
                                  onClick={() =>
                                    setSelected(String(row[spec!.key]))
                                  }
                                >
                                  {fieldFor(key)?.reference
                                    ? referenceLabel(
                                        fieldFor(key)!.reference!,
                                        row[key],
                                      )
                                    : display(
                                        row[key] ||
                                          (key === "voyage_number"
                                            ? "번호 미정"
                                            : null),
                                        fieldFor(key),
                                      )}
                                </button>
                                {isDummyRow(row) && <DummyBadge row={row} />}
                              </>
                            ) : fieldFor(key)?.reference ? (
                              referenceLabel(
                                fieldFor(key)!.reference!,
                                cellValue(row, key),
                              )
                            ) : (
                              display(cellValue(row, key), fieldFor(key))
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <div className="vr-empty">
                    <Database size={30} />
                    <h3>
                      {hasFilters
                        ? "조건에 맞는 결과가 없습니다"
                        : `${spec!.label} 기록이 없습니다`}
                    </h3>
                    <p>
                      {hasFilters
                        ? "검색어와 날짜, 상태 조건을 확인해 주세요."
                        : "배선 등록에서 아는 정보부터 입력하거나 엑셀 양식으로 한 번에 가져오세요. 선박과 항차번호는 나중에 지정할 수 있습니다."}
                    </p>
                    {hasFilters ? <button onClick={resetFilters}>조건 초기화 <ArrowRight size={14} /></button> : writable && entity !== "voyages" && (
                      <button
                        onClick={() => {
                          setEntity("voyages");
                          setSelected("");
                        }}
                      >
                        배선 원장으로 이동 <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <footer className="vr-table-footer">
                번호가 같으면 갱신 · 누락된 행은 보존 · 등록만으로 입하·재고에
                반영되지 않습니다.
              </footer>
            </div>
            <aside className="vr-detail" aria-label="원장 상세">
              <div className="vr-panel-title">
                <h2>
                  {selectedRow
                    ? referenceLabel(entity, selectedRow[spec!.key])
                    : "상세 정보"}
                </h2>
                {writable && selectedRow && (
                  <button
                    disabled={busy}
                    onClick={() => openEditor(String(selectedRow[spec!.key]))}
                  >
                    <Pencil size={14} /> 수정
                  </button>
                )}
              </div>
              <div className="vr-detail-scroll">
                {selectedRow ? (
                  <>
                    <p className="vr-detail-caption">
                      {selectedRow.data_origin === "dummy"
                        ? "더미 자료"
                        : selectedRow.data_origin === "mixed"
                          ? "수기 입력 · 일부 더미"
                          : "수기 입력"}{" "}
                      · {spec!.label} 원장
                      {isDummyRow(selectedRow) && <DummyBadge row={selectedRow} />}
                    </p>
                    {(entity === "cargo" || entity === "assays") && (
                      <QualitySummary
                        data={data}
                        fields={schema.assays.fields}
                        cargoId={String(
                          entity === "cargo"
                            ? selectedRow.cargo_no
                            : selectedRow.cargo_no,
                        )}
                      />
                    )}
                    <dl>
                      {visibleFields(spec!.fields)
                        .filter(
                          (f) =>
                            f.key !== spec!.key &&
                            !(entity === "voyages" && f.key === "plan_name" && !selectedRow[f.key]) &&
                            !(
                              entity === "assays" &&
                              f.group === "기존 성상값" &&
                              !selectedRow[f.key]
                            ),
                        )
                        .map((f) => (
                          <div key={f.key}>
                            <dt>{entity === "voyages" && f.key === "notes" ? "배선 메모" : f.label}</dt>
                            <dd>
                              {f.reference && selectedRow[f.key] ? (
                                <button
                                  className="vr-record-link"
                                  onClick={() => {
                                    setEntity(f.reference!);
                                    setSelected(String(selectedRow[f.key]));
                                    setQuery("");
                                  }}
                                >
                                  {referenceLabel(
                                    f.reference,
                                    selectedRow[f.key],
                                  )}{" "}
                                  <ArrowRight size={12} />
                                </button>
                              ) : (
                                display(selectedRow[f.key], f)
                              )}
                              {dummyFieldKeys(selectedRow, spec!.fields, spec!.key).has(f.key) && (
                                <DummyBadge field />
                              )}
                            </dd>
                          </div>
                        ))}
                    </dl>
                    {(entity === "ships" || entity === "voyages") && (
                      <div className="vr-related">
                        <h3>
                          {entity === "ships" ? "연결 항차" : "등록 화물"}
                        </h3>
                        {(entity === "ships"
                          ? data.voyages.filter(
                              (v) => v.ship_code === selectedRow.ship_code,
                            )
                          : data.cargo.filter(
                              (c) => c.voyage_no === selectedRow.voyage_no,
                            )
                        ).map((r) => (
                          <button
                            key={String(
                              r[entity === "ships" ? "voyage_no" : "cargo_no"],
                            )}
                            onClick={() => {
                              setEntity(
                                entity === "ships" ? "voyages" : "cargo",
                              );
                              setSelected(
                                String(
                                  r[
                                    entity === "ships"
                                      ? "voyage_no"
                                      : "cargo_no"
                                  ],
                                ),
                              );
                              setQuery("");
                              setStatusFilter("");
                              setDateFrom("");
                              setDateTo("");
                            }}
                          >
                            {referenceLabel(
                              entity === "ships" ? "voyages" : "cargo",
                              r[entity === "ships" ? "voyage_no" : "cargo_no"],
                            )}
                            <ArrowRight size={13} />
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="vr-detail-caption">
                      마지막 수정{" "}
                      {String(selectedRow.updated_at)
                        .slice(0, 16)
                        .replace("T", " ")}{" "}
                      KST
                    </p>
                  </>
                ) : (
                  <p className="vr-detail-caption">
                    목록에서 행을 선택하면 일정·성상과 연결 정보를 확인할 수
                    있습니다.
                  </p>
                )}
              </div>
            </aside>
          </div>
          <footer className="vr-bottom">
            <span>공유 수기 자료 · AIS 위치와 별도 관리</span>
            <button onClick={() => setHistory(true)}>
              <History size={15} /> 최근 변경 이력
            </button>
          </footer>
        </>
      )}
      <Dialog.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="vr-overlay" />
          <Dialog.Content
            className="vr-dialog"
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault();
            }}
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <header>
              <div>
                <Dialog.Title>
                  {file
                    ? "엑셀 반영 검토"
                    : `${schema?.[editing?.entity ?? entity].label} ${editing?.key ? "수정" : "등록"}`}
                </Dialog.Title>
                <Dialog.Description>
                  {file
                    ? file.name
                    : "필수 항목은 * 표시 · 관리ID는 자동 생성됩니다."}
                </Dialog.Description>
              </div>
              <button
                disabled={busy}
                aria-label="입력 닫기"
                onClick={closeEditor}
              >
                <X size={20} />
              </button>
            </header>
            <div className="vr-dialog-scroll">
              {dialogError && (
                <p className="vr-error" role="alert">
                  {dialogError}
                </p>
              )}
              {editing && !review && (
                <form
                  id="vr-editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void previewManual();
                  }}
                  className="vr-form"
                >
                  {visibleFields(schema![editing.entity].fields)
                    .filter(
                      (f) =>
                        f.key !== schema![editing.entity].key &&
                        !(
                          editing.entity === "assays" &&
                          f.group === "기존 성상값" &&
                          !editing.draft[f.key]
                        ),
                    )
                    .sort((a, b) =>
                      editing.entity === "assays"
                        ? assayGroups.indexOf(a.group ?? "") -
                          assayGroups.indexOf(b.group ?? "")
                        : 0,
                    )
                    .map((f, index, fields) => (
                      <Fragment key={f.key}>
                        {editing.entity === "assays" &&
                          f.group !== fields[index - 1]?.group && (
                            <h3 className="vr-form-group">{f.group}</h3>
                          )}
                        <label
                          key={f.key}
                          className={f.kind === "memo" ? "vr-wide" : ""}
                        >
                          {f.label}
                          {f.required && " *"}
                          {f.choices || f.reference ? (
                            <select
                              disabled={busy}
                              aria-label={f.label + (f.required ? " *" : "")}
                              value={String(editing.draft[f.key] ?? "")}
                              required={f.required}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  draft: {
                                    ...editing.draft,
                                    [f.key]: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="">선택</option>
                              {f.choices
                                ? Object.entries(f.choices).map(
                                    ([code, label]) => (
                                      <option key={code} value={code}>
                                        {label} · {code}
                                      </option>
                                    ),
                                  )
                                : data![f.reference!].map((r) => {
                                    const code = String(
                                      r[schema![f.reference!].key],
                                    );
                                    return (
                                      <option key={code} value={code}>
                                        {referenceLabel(f.reference!, code)}
                                      </option>
                                    );
                                  })}
                            </select>
                          ) : f.kind === "memo" ? (
                            <textarea
                              disabled={busy}
                              aria-label={f.label}
                              rows={3}
                              maxLength={2000}
                              value={String(editing.draft[f.key] ?? "")}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  draft: {
                                    ...editing.draft,
                                    [f.key]: e.target.value,
                                  },
                                })
                              }
                            />
                          ) : (
                            <input
                              disabled={busy}
                              aria-label={f.label + (f.required ? " *" : "")}
                              type={
                                f.kind === "datetime"
                                  ? "datetime-local"
                                  : f.kind === "date"
                                    ? "date"
                                    : f.kind === "number"
                                      ? "number"
                                      : "text"
                              }
                              step={f.kind === "number" ? "any" : undefined}
                              min={f.min}
                              max={f.max}
                              maxLength={
                                f.kind === "code" ? 64 : (f.digits ?? 200)
                              }
                              required={f.required}
                              readOnly={
                                !!editing.key &&
                                f.key === schema![editing.entity].key
                              }
                              value={
                                f.kind === "datetime"
                                  ? String(editing.draft[f.key] ?? "").slice(
                                      0,
                                      16,
                                    )
                                  : (editing.draft[f.key] ?? "")
                              }
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  draft: {
                                    ...editing.draft,
                                    [f.key]: e.target.value,
                                  },
                                })
                              }
                            />
                          )}
                          {f.reference && !data![f.reference].length && (
                            <small>
                              먼저 {schema![f.reference].label}을 등록해 주세요.
                            </small>
                          )}
                        </label>
                        {editing.entity === "cargo" && !editing.key && f.key === "voyage_no" && editing.draft.voyage_no && (
                          <div className="vr-wide vr-detail-caption">
                            {data!.cargo.filter(c => c.voyage_no === editing.draft.voyage_no).length ? (
                              <>
                                <p>이 배선에 이미 등록된 화물입니다. 선택하면 입력된 정보를 이어서 수정합니다.</p>
                                {data!.cargo.filter(c => c.voyage_no === editing.draft.voyage_no).map(c => (
                                  <button key={String(c.cargo_no)} type="button" disabled={busy} onClick={() => {
                                    const draft = Object.fromEntries(visibleFields(schema!.cargo.fields).map(field => [field.key, c[field.key] ?? ""]));
                                    setEditing({ entity: "cargo", key: String(c.cargo_no), draft, revision: editing.revision });
                                  }}>
                                    {String(c.coal_name || "탄종 미입력")} · 기존 화물 수정
                                  </button>
                                ))}
                                <p>다른 화물이면 아래에 새로 입력하세요.</p>
                              </>
                            ) : <p>이 배선에 등록된 화물이 없습니다. 아래에 새 화물을 입력하세요.</p>}
                          </div>
                        )}
                      </Fragment>
                    ))}
                  {editing.entity === "assays" && (
                    <div className="vr-wide vr-assay-note">
                      <strong>원소분석 Ash(DB) · 계산값</strong>
                      <p>
                        {editing.draft.ash_adb != null &&
                        editing.draft.ash_adb !== "" &&
                        editing.draft.im_adb != null &&
                        editing.draft.im_adb !== "" &&
                        Number(editing.draft.im_adb) < 100
                          ? `${((Number(editing.draft.ash_adb) * 100) / (100 - Number(editing.draft.im_adb))).toFixed(3)} %wt`
                          : "공업분석 회분과 고유수분을 입력하면 계산합니다."}
                      </p>
                      <small>
                        Ash(DB) = Ash(ADB) × 100 ÷ (100 − IM). 총수분으로
                        대체하지 않습니다. NCV 기준 미확인 값은 환산·혼탄 계산에
                        사용하지 않습니다.
                      </small>
                    </div>
                  )}
                  {editing.entity === "cargo" && (
                    <p className="vr-wide vr-detail-caption">
                      예정물량 또는 B/L물량 중 하나 이상 입력합니다. 빈값은
                      미확인, 0은 실제 0입니다. 열량·회분·황분에는 분석기준도
                      지정하세요.
                    </p>
                  )}
                </form>
              )}
              {busy && !review && file && (
                <ProcessingOrb state="solving" label="엑셀 헤더·참조·물량을 검증하는 중" />
              )}
              {review && (
                <>
                  <div className="vr-review-summary">
                    <strong>추가 {review.counts.create}건</strong>
                    <strong>수정 {review.counts.update}건</strong>
                    <span>변경 없음 {review.unchanged}건</span>
                    <span>오류 {review.errors.length}건</span>
                  </div>
                  <p className="vr-detail-caption">
                    같은 번호의 행은 아래 값으로 갱신됩니다. 선택 항목의 빈칸은
                    기존 값을 지웁니다. 파일에서 빠진 행은 삭제하지 않습니다.
                  </p>
                  {!!review.errors.length && (
                    <div role="alert" className="vr-validation">
                      {review.errors.map((e, i) => (
                        <p key={i}>
                          <strong>
                            {e.sheet} {e.row}행 · {e.column}
                          </strong>{" "}
                          {e.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {review.stale_workbook && (
                    <label className="vr-stale">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                      />
                      이 파일은 이전 원장 v{review.source_revision}입니다. 현재
                      v{review.revision}과 변경 전후를 확인했습니다.
                    </label>
                  )}
                  {review.changes.map((c) => (
                    <details
                      className="vr-change"
                      key={`${c.entity}-${c.key}`}
                      open={review.changes.length <= 3}
                    >
                      <summary>
                        {c.action === "create" ? "추가" : "수정"} · {c.sheet} ·{" "}
                        {c.key}
                      </summary>
                      <dl>
                        {visibleFields(schema![c.entity].fields)
                          .filter((f) => c.before?.[f.key] !== c.after[f.key])
                          .map((f) => (
                            <div key={f.key}>
                              <dt>{f.label}</dt>
                              <dd>
                                <del>
                                  {display(c.before?.[f.key] ?? null, f)}
                                </del>
                                <ArrowRight size={12} />
                                <strong>{display(c.after[f.key], f)}</strong>
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  ))}
                  {!review.errors.length && !review.changes.length && (
                    <p>반영할 변경이 없습니다.</p>
                  )}
                </>
              )}
            </div>
            <footer>
              {review && editing ? (
                <button
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setDialogError("");
                  }}
                >
                  입력으로 돌아가기
                </button>
              ) : (
                <button disabled={busy} onClick={closeEditor}>
                  취소
                </button>
              )}
              {!review && editing ? (
                <button
                  className="vr-primary"
                  disabled={busy}
                  type="submit"
                  form="vr-editor"
                >
                  {busy ? "검증 중…" : "변경 내용 확인"}
                </button>
              ) : (
                review && (
                  <button
                    className="vr-primary"
                    disabled={
                      busy ||
                      !!review.errors.length ||
                      !review.changes.length ||
                      (!!review.stale_workbook && !acknowledged)
                    }
                    onClick={() => void save()}
                  >
                    {busy ? "저장 중…" : "공용 원장에 반영"}
                  </button>
                )
              )}
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={history} onOpenChange={setHistory}>
        <Dialog.Portal>
          <Dialog.Overlay className="vr-overlay" />
          <Dialog.Content className="vr-dialog">
            <header>
              <div>
                <Dialog.Title>최근 변경 이력</Dialog.Title>
                <Dialog.Description>
                  최근 100건 · 변경 시각 KST · 작업자 계정 ID 기록
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="이력 닫기">
                <X size={20} />
              </Dialog.Close>
            </header>
            <div className="vr-dialog-scroll">
              {data?.audit.length ? (
                data.audit.map((a) => {
                  const before = parseAuditRow(a.before_json) ?? {};
                  const after = parseAuditRow(a.after_json);
                  return (
                    <details className="vr-change" key={a.id}>
                      <summary>
                        {a.at.slice(0, 16).replace("T", " ")} ·{" "}
                        {schema?.[a.entity]?.label} {a.record_key} ·{" "}
                        {auditOriginLabel(a.origin)}
                        {after === null && " · 삭제"}
                      </summary>
                      <p className="vr-detail-caption">
                        v{a.revision} · {a.actor}
                        {after === null && " · 아래는 삭제 전 값입니다."}
                      </p>
                      <dl>
                        {visibleFields(schema?.[a.entity]?.fields ?? [])
                          .filter((f) =>
                            after === null
                              ? before[f.key] != null
                              : before[f.key] !== after[f.key],
                          )
                          .map((f) => (
                            <div key={f.key}>
                              <dt>{f.label}</dt>
                              <dd>
                                <del>{display(before[f.key] ?? null, f)}</del>
                                <ArrowRight size={12} />
                                {after === null
                                  ? "삭제"
                                  : display(after[f.key] ?? null, f)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  );
                })
              ) : (
                <p>아직 저장된 변경이 없습니다.</p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
