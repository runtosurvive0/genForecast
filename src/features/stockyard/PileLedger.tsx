import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Section } from "@/components/tower/primitives";
import { number as n } from "@/lib/format";
import {
  ledgerCsv,
  sortLedger,
  type LedgerKey,
  type LedgerRow,
} from "./stockyard-domain";

export const LEDGER_PAGE_SIZE = 20;
const COLUMNS: { key: LedgerKey; label: string }[] = [
  { key: "id", label: "Pile" },
  { key: "yard", label: "발전소 · 처" },
  { key: "coal", label: "탄종" },
  { key: "tons", label: "재고 · t" },
  { key: "cv", label: "열량" },
  { key: "age", label: "적치 · 일" },
  { key: "risk", label: "위험도" },
  { key: "burn", label: "주간 소진 · t" },
  { key: "after", label: "잔량 · t" },
  { key: "incoming", label: "하역 예정 · t" },
];
const groupOf = (r: LedgerRow) => (r.yard === "-" ? r.plantName : `${r.plantName} ${r.yard}`);

/** Pile 원장: 정렬·필터·20행 페이지·CSV, 행 선택은 약도·패널과 동기화. */
export function PileLedger({
  rows,
  riskFilter,
  selectedId,
  onSelect,
  jump,
  renderDetail,
  source,
}: {
  rows: LedgerRow[];
  riskFilter: "all" | "낮음" | "관찰" | "높음";
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** "원장에서 보기" 요청 번호. 바뀌면 선택 Pile이 있는 페이지로 이동하고 펼친다. */
  jump: number;
  renderDetail: (row: LedgerRow) => ReactNode;
  source: string;
}) {
  const [sortKey, setSortKey] = useState<LedgerKey>("tons");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => [...new Set(rows.map(groupOf))], [rows]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortLedger(
      rows.filter(
        (r) =>
          (riskFilter === "all" || r.riskLabel === riskFilter) &&
          (group === "all" || groupOf(r) === group) &&
          (!q ||
            r.pile.stockpile_id.toLowerCase().includes(q) ||
            r.pile.coal_type.toLowerCase().includes(q)),
      ),
      sortKey,
      dir,
    );
  }, [rows, riskFilter, group, query, sortKey, dir]);
  const pages = Math.max(1, Math.ceil(visible.length / LEDGER_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * LEDGER_PAGE_SIZE, (current + 1) * LEDGER_PAGE_SIZE);

  useEffect(() => {
    if (!jump || !selectedId) return;
    let index = visible.findIndex((r) => r.pile.stockpile_id === selectedId);
    if (index < 0) {
      setGroup("all");
      setQuery("");
      index = sortLedger(rows, sortKey, dir).findIndex((r) => r.pile.stockpile_id === selectedId);
    }
    if (index >= 0) setPage(Math.floor(index / LEDGER_PAGE_SIZE));
    setExpanded(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  const sortBy = (key: LedgerKey) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(key === "id" || key === "yard" || key === "coal" ? "asc" : "desc");
    }
    setPage(0);
  };
  const download = () => {
    const blob = new Blob(["﻿" + ledgerCsv(visible, source)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "저탄장_Pile_원장.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Section
      title="전체 Pile 원장"
      note={`${visible.length}개 · ${LEDGER_PAGE_SIZE}행 페이지 · 헤더를 눌러 정렬 · 행을 누르면 상세와 약도 선택`}
      action={
        <button className="stockyard-csv" onClick={download}>
          CSV
        </button>
      }
    >
      <div className="ledger-filters">
        <div className="stockyard-segment" role="group" aria-label="원장 처 필터">
          <button aria-pressed={group === "all"} onClick={() => (setGroup("all"), setPage(0))}>
            전체
          </button>
          {groups.map((g) => (
            <button key={g} aria-pressed={group === g} onClick={() => (setGroup(g), setPage(0))}>
              {g}
            </button>
          ))}
        </div>
        <input
          aria-label="원장 검색"
          placeholder="Pile·탄종 검색"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <div className="tower-table-wrap">
        <table className="tower-table stockyard-ledger">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  aria-sort={sortKey === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button onClick={() => sortBy(c.key)}>
                    {c.label}
                    {sortKey === c.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.flatMap((r) => {
              const id = r.pile.stockpile_id;
              const rowsOut = [
                <tr
                  key={id}
                  className={selectedId === id ? "is-selected" : undefined}
                  aria-selected={selectedId === id}
                >
                  <td>
                    <button
                      aria-expanded={expanded === id}
                      onClick={() => {
                        onSelect(id);
                        setExpanded((e) => (e === id ? null : id));
                      }}
                    >
                      {id}
                    </button>
                  </td>
                  <td>{groupOf(r)}</td>
                  <td>{r.pile.coal_type}</td>
                  <td>{n(r.pile.on_hand_t)}</td>
                  <td>{n(r.pile.calorific_value_kcal_kg)}</td>
                  <td>{r.age}</td>
                  <td>
                    <span className={`risk-text risk-${r.riskLabel === "높음" ? "high" : r.riskLabel === "관찰" ? "medium" : "low"}`}>
                      {r.riskLabel} · {r.riskScore}
                    </span>
                  </td>
                  <td>{r.burnedTons ? n(r.burnedTons) : "-"}</td>
                  <td>{n(r.afterTons)}</td>
                  <td>{r.incomingTons ? n(r.incomingTons) : "-"}</td>
                </tr>,
              ];
              if (expanded === id)
                rowsOut.push(
                  <tr key={`${id}-detail`} className="ledger-detail">
                    <td colSpan={COLUMNS.length}>{renderDetail(r)}</td>
                  </tr>,
                );
              return rowsOut;
            })}
            {!shown.length && (
              <tr>
                <td colSpan={COLUMNS.length}>조건에 맞는 Pile이 없습니다</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="ledger-pager" aria-label="원장 페이지">
        <button disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="이전 페이지">
          ‹
        </button>
        {Array.from({ length: pages }, (_, i) => (
          <button key={i} aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>
            {i + 1}
          </button>
        ))}
        <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="다음 페이지">
          ›
        </button>
      </nav>
    </Section>
  );
}
