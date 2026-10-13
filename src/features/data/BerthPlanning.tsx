import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/tower/primitives";
import { readJson } from "@/domain/planning";
import type { PlanningState } from "@/domain/use-planning";
import { initialPlanningQuery } from "@/domain/use-planning";
import { useAccount } from "@/lib/account-context";
import { number as n } from "@/lib/format";

type Candidate = {
  id: string;
  start_at: string | null;
  end_at: string | null;
  reason: string;
  inventory_days: number | null;
};
type Comparison = {
  id: string;
  name: string;
  daily: { day: string; assigned: Day; include_waiting: Day }[];
};
type Day = {
  groups: Record<string, { stock: number | null; shortage: number | null }>;
  stock_including_port: number | null;
};
const amount = (v: number | null | undefined) =>
  v == null ? "미확정" : `${n(v)} t`;
const total = (d: Day) =>
  Object.values(d.groups).some((g) => g.stock == null)
    ? null
    : Object.values(d.groups).reduce((sum, g) => sum + g.stock!, 0);
const local = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 16);
const post = (path: string, body: unknown) =>
  readJson(path, undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function BerthPlanning({ planning: p }: { planning: PlanningState }) {
  const account = useAccount();
  const admin = account?.user.role === "admin";
  const [selected, setSelected] = useState("");
  const [recommendation, setRecommendation] = useState<{
    candidates: Candidate[];
    version: number;
  } | null>(null);
  const [berth, setBerth] = useState("BD-1");
  const [startAt, setStartAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [history, setHistory] = useState<
    { id: string; name: string; recorded_at: string }[]
  >([]);
  const [name, setName] = useState("");
  const [cargo, setCargo] = useState("80000");
  const [cv, setCv] = useState("5500");
  const [eta, setEta] = useState("");
  const [mmsi, setMmsi] = useState("");
  const [imo, setImo] = useState("");
  const [voyageKey, setVoyageKey] = useState<string>(() => crypto.randomUUID());
  const [importId, setImportId] = useState("");
  const [commonPlan, setCommonPlan] = useState(false);
  const [grade, setGrade] = useState("");
  const [masters, setMasters] = useState<
    { id: string; group_id: string; rate_tpd: number; enabled: number }[]
  >([]);
  const context = p.query && {
    run_id: p.query.runId,
    start: p.query.start,
    horizon: p.query.horizon,
  };
  useEffect(() => {
    setRecommendation(null);
    setSelected("");
    setStartAt("");
  }, [p.query?.runId, p.query?.start, p.query?.horizon]);
  useEffect(() => {
    if (p.query && !eta) setEta(`${p.query.start}T00:00`);
  }, [p.query?.start, eta]);
  useEffect(() => {
    const controller = new AbortController();
    readJson("/api/supply/simulations", controller.signal)
      .then((v) => setHistory(v as typeof history))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    readJson("/api/supply/berths", controller.signal)
      .then((v) => setMasters((v as { berths: typeof masters }).berths))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setBusy(false);
    }
  }
  function choose(c: Candidate) {
    setBerth(c.id);
    setStartAt(c.start_at ? local(c.start_at) : "");
  }
  async function loadHistory() {
    setHistory((await readJson("/api/supply/simulations")) as typeof history);
  }
  return (
    <div className="milp-admin">
      {error && (
        <p role="alert" className="milp-upload-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <Section
        title="부두 배정·재고 시뮬레이션"
        note="BD-1→1처 · BD-2→2처 · BD-3→3처 · 실측·운영 지시와 구분"
      >
        <div className="milp-admin-actions">
          <label>
            기준 MILP 계산{" "}
            <select
              aria-label="배정 기준 MILP 계산"
              value={p.query?.runId ?? ""}
              disabled={busy || p.listLoading}
              onChange={(e) => {
                const r = p.runs.find((r) => r.id === e.target.value);
                if (r) p.setQuery(initialPlanningQuery(r));
              }}
            >
              {!p.runs.length && <option value="">계산 없음</option>}
              {p.runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.period}
                </option>
              ))}
            </select>
          </label>
          <label>
            기준일 KST{" "}
            <input
              aria-label="배정 조회 기준일"
              type="date"
              value={p.query?.start ?? ""}
              disabled={busy || !p.query}
              onChange={(e) =>
                p.query &&
                e.target.value &&
                p.setQuery({ ...p.query, start: e.target.value })
              }
            />
          </label>
        </div>
        <label>
          전망 기간{" "}
          <select aria-label="배정 전망 기간" value={p.query?.horizon ?? 30}
            disabled={busy || !p.query}
            onChange={(e) => p.query && p.setQuery({ ...p.query, horizon: Number(e.target.value) })}>
            {[7, 30, 60, 90].map((days) => <option key={days} value={days}>{days}일</option>)}
          </select>
        </label>
        <p className="tower-footnote">
          {p.failed ||
            "빈 부두를 우선하고, 연결 처의 재고일수가 낮은 부두를 추천합니다. 기본 하역능력은 7,000t/일이며 화물 잔량과 점유·예약시간을 반영합니다."}
        </p>
        {!admin && (
          <p>
            공통 원장의 항차 등록·배정 확정은 관리자 권한이 필요합니다. 전망
            비교·저장은 승인된 회원이 사용할 수 있습니다.
          </p>
        )}
      </Section>
      <Section
        title="부두 조건"
        note="배정 변경 이력을 보존하며 예약 중에는 조건 변경을 제한합니다."
      >
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>부두</th>
                <th>하역능력 t/일</th>
                <th>사용 가능</th>
                <th>저장</th>
              </tr>
            </thead>
            <tbody>
              {masters.map((b, i) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>
                    <input
                      aria-label={`${b.id} 하역능력`}
                      type="number"
                      min="1"
                      max="100000"
                      disabled={!admin || busy}
                      value={b.rate_tpd}
                      onChange={(e) =>
                        setMasters(
                          masters.map((x, j) =>
                            i === j
                              ? { ...x, rate_tpd: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${b.id} 사용 가능`}
                      type="checkbox"
                      checked={!!b.enabled}
                      disabled={!admin || busy}
                      onChange={(e) =>
                        setMasters(
                          masters.map((x, j) =>
                            i === j
                              ? { ...x, enabled: Number(e.target.checked) }
                              : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <Button
                      disabled={!admin || busy}
                      onClick={() =>
                        void action(async () => {
                          await readJson(
                            `/api/supply/berths/${b.id}`,
                            undefined,
                            {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                rate_tpd: b.rate_tpd,
                                enabled: !!b.enabled,
                              }),
                            },
                          );
                          setMessage("부두 조건을 저장했습니다.");
                          p.refresh();
                        })
                      }
                    >
                      {b.id} 조건 저장
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        title="수급 항차 등록"
        note="항차 키·MMSI/IMO로 연결하며 실적과 구분합니다. 기본은 선택한 가상 계산에만 등록됩니다."
      >
        <label>
          <input
            type="checkbox"
            checked={commonPlan}
            disabled={!admin || busy}
            onChange={(e) => setCommonPlan(e.target.checked)}
          />{" "}
          공통 입하계획으로 등록 · 다른 계산에서도 사용
        </label>
        <label>
          선박추적의 내 항차 가져오기{" "}
          <select
            aria-label="수급 항차 가져오기"
            value={importId}
            disabled={!admin || busy}
            onChange={(e) => {
              setImportId(e.target.value);
              const v = account?.workspace.voyages.find(
                (v) => v.id === e.target.value,
              );
              const ship = account?.workspace.vessels.find(
                (s) => s.id === v?.vesselId,
              );
              if (!v || !ship) return;
              setName(ship.name);
              setCargo(String(v.cargoT));
              setCv(String(v.cv));
              setMmsi(ship.mmsi);
              setImo(ship.imo.startsWith("DEMO") ? "" : ship.imo);
              setVoyageKey(`workspace:${account!.user.id}:${v.id}`);
              const arrival = v.actualArrivalAt ?? v.plannedEta;
              if (arrival) setEta(local(arrival));
            }}
          >
            <option value="">수기로 입력</option>
            {account?.workspace.voyages
              .filter((v) => v.plantId === "dangjin" && v.state !== "cancelled")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {
                    account.workspace.vessels.find((s) => s.id === v.vesselId)
                      ?.name
                  }{" "}
                  · {v.destination}
                </option>
              ))}
          </select>
        </label>
        <form
          className="milp-upload-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!context) return;
            void action(async () => {
              await post("/api/supply/shipments", {
                run_id: commonPlan ? null : context.run_id,
                name,
                cargo: Number(cargo),
                incoming_cv: Number(cv),
                arrival_at: `${eta}:00+09:00`,
                mmsi: mmsi || null,
                imo: imo || null,
                coal_grade: grade || null,
                voyage_key: voyageKey,
              });
              setMessage(
                "수급 항차를 등록했습니다. 입고량은 부두 배정 이후 하역 일정에 따라 반영됩니다.",
              );
              p.refresh();
            });
          }}
        >
          <label>
            항차 키 · 같은 화물은 같은 키 사용
            <input required maxLength={150} value={voyageKey} aria-label="수급 항차 키" onChange={e => setVoyageKey(e.target.value)} />
          </label>
          <label>
            선박명{" "}
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="수급 선박명"
            />
          </label>
          <label>
            화물량 t{" "}
            <input
              required
              type="number"
              min="1"
              max="1000000"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              aria-label="수급 화물량"
            />
          </label>
          <label>
            발열량 kcal/kg{" "}
            <input
              required
              type="number"
              min="1000"
              max="10000"
              value={cv}
              onChange={(e) => setCv(e.target.value)}
              aria-label="수급 발열량"
            />
          </label>
          <label>
            탄종 구분{" "}
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              aria-label="수급 탄종"
            >
              <option value="">미확정</option>
              <option value="high">고열량</option>
              <option value="low">저열량</option>
              <option value="blend">혼합탄</option>
            </select>
          </label>
          <label>
            입항 예정 KST{" "}
            <input
              required
              type="datetime-local"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              aria-label="수급 입항 예정"
            />
          </label>
          <label>
            MMSI{" "}
            <input
              value={mmsi}
              pattern="[0-9]{9}"
              onChange={(e) => setMmsi(e.target.value)}
              aria-label="수급 MMSI"
            />
          </label>
          <label>
            IMO{" "}
            <input
              value={imo}
              pattern="[0-9]{7}"
              onChange={(e) => setImo(e.target.value)}
              aria-label="수급 IMO"
            />
          </label>
          <Button disabled={!admin || busy || !context} type="submit">
            수급 항차 등록
          </Button>
          <Button
            disabled={!admin || busy}
            type="button"
            variant="outline"
            onClick={() => {
              setVoyageKey(crypto.randomUUID());
              setName("");
              setMmsi("");
              setImo("");
              setImportId("");
            }}
          >
            새 항차 입력
          </Button>
        </form>
        <p className="tower-footnote">
          AIS는 화물량·발열량을 제공하지 않으므로 등록값을 확인해야 합니다.
          가져오기는 내 항차를 자동 수정하지 않습니다.
        </p>
      </Section>
      <Section
        title="부두 추천·배정 확정"
        note="추천은 조회 기준시각·ETA와 기존 하역/예약을 함께 확인합니다."
      >
        <div className="milp-admin-actions">
          <label>
            수급 항차{" "}
            <select
              aria-label="배정할 수급 항차"
              value={selected}
              disabled={busy || !p.current}
              onChange={(e) => {
                setSelected(e.target.value);
                setRecommendation(null);
              }}
            >
              <option value="">항차 선택</option>
              {p.current?.vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {n(v.remaining)}t · {v.state}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !selected || !context}
            onClick={() =>
              void action(async () => {
                const query = new URLSearchParams({
                  ...context!,
                  horizon: String(context!.horizon),
                  vessel_id: selected,
                });
                const r = (await readJson(
                  `/api/supply/berth-recommendations?${query}`,
                )) as NonNullable<typeof recommendation>;
                setRecommendation(r);
                if (r.candidates[0]) choose(r.candidates[0]);
              })
            }
          >
            부두 추천 조회
          </Button>
        </div>
        {recommendation && (
          <>
            <ul>
              {recommendation.candidates.map((c) => (
                <li key={c.id}>
                  <label>
                    <input
                      type="radio"
                      name="candidate"
                      checked={berth === c.id}
                      disabled={!c.start_at || busy}
                      onChange={() => choose(c)}
                    />{" "}
                    {c.id} · {c.reason}
                  </label>
                </li>
              ))}
            </ul>
            <label>
              하역 시작 KST{" "}
              <input
                aria-label="배정 하역 시작"
                type="datetime-local"
                value={startAt}
                disabled={busy}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </label>
            <div className="milp-admin-actions">
              {(["reserved", "cancelled"] as const).map((status) => (
                <Button
                  key={status}
                  disabled={!admin || busy || !startAt}
                  onClick={() =>
                    void action(async () => {
                      await post("/api/supply/berth-assignments", {
                        ...context,
                        vessel_id: Number(selected),
                        berth_id: berth,
                        start_at: `${startAt}:00+09:00`,
                        expected_version: recommendation.version,
                        status,
                      });
                      setMessage(
                        status === "reserved"
                          ? "부두 배정을 저장했습니다. 공통 재고전망을 다시 조회합니다."
                          : "배정을 취소했습니다. 항차는 대기로 유지합니다.",
                      );
                      setRecommendation(null);
                      p.refresh();
                    })
                  }
                >
                  {status === "reserved" ? "부두 배정 확정" : "배정 취소"}
                </Button>
              ))}
            </div>
          </>
        )}
      </Section>
      <Section
        title="기본·체선 포함 전망 비교"
        note="같은 입력으로 두 옵션을 계산·저장합니다. 가상 배정은 실제 예약을 변경하지 않습니다."
      >
        <div className="milp-admin-actions">
          <Button
            disabled={busy || !context || !p.current}
            onClick={() =>
              void action(async () => {
                const result = (await post("/api/supply/simulations", {
                  ...context,
                  name: `수급 비교 ${context!.start}`,
                })) as { id: string };
                setComparison(
                  (await readJson(
                    `/api/supply/simulations/${result.id}`,
                  )) as Comparison,
                );
                await loadHistory();
                setMessage("입력과 일별 결과를 DB에 저장했습니다.");
              })
            }
          >
            두 옵션 계산·DB 저장
          </Button>
          <label>
            저장 결과{" "}
            <select
              aria-label="저장된 수급 시뮬레이션"
              value={comparison?.id ?? ""}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                if (id)
                  void action(async () =>
                    setComparison(
                      (await readJson(
                        `/api/supply/simulations/${id}`,
                      )) as Comparison,
                    ),
                  );
              }}
            >
              <option value="">결과 선택</option>
              {history.map((h) => (
                <option value={h.id} key={h.id}>
                  {h.name} · {h.recorded_at.slice(0, 16)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {comparison && (
          <div className="tower-table-wrap">
            <table className="tower-table">
              <caption>
                {comparison.name} · 계획상 음수는 부족량 · KST 일말
              </caption>
              <thead>
                <tr>
                  <th>일자</th>
                  <th>기본 저탄장</th>
                  <th>체선 포함 저탄장</th>
                  <th>기본 항내 확보량</th>
                  <th>체선 포함 항내 확보량</th>
                </tr>
              </thead>
              <tbody>
                {comparison.daily.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{amount(total(d.assigned))}</td>
                    <td>{amount(total(d.include_waiting))}</td>
                    <td>{amount(d.assigned.stock_including_port)}</td>
                    <td>{amount(d.include_waiting.stock_including_port)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
