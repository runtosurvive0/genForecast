import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/tower/primitives";
import { number as n } from "@/lib/format";

type InputSet = {
  id: number;
  name: string;
  start: string;
  end: string;
  recorded_at: string;
};
type InputDetail = {
  id: number;
  payload: {
    scenario: {
      name: string;
      start: string;
      end: string;
      coal_oh: unknown[];
      nuclear_oh: unknown[];
      quality: string;
    };
    heat_prices: Record<string, number[]>;
  };
};
type Job = {
  state: string;
  run_id?: string;
  stage?: string;
  message?: string;
  windows_done?: number;
  windows_total?: number;
  error?: string;
};
type Execution = {
  id: string;
  input_id: number;
  state: string;
  error?: string;
  summary: {
    scenario: { name: string; start: string; end: string };
    annual: { dangjin_mwh: number };
    solve: { window_status: Record<string, number> };
  } | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Python API 서버 연결을 확인하세요.");
  }
  if (!response.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `요청 실패 (${response.status})`,
    );
  return body as T;
}

export function MilpUpload({
  onResult,
}: {
  onResult: (run: { id: string; start: string; end: string }) => void;
}) {
  const [inputs, setInputs] = useState<InputSet[]>([]);
  const [selected, setSelected] = useState<InputDetail | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [job, setJob] = useState<Job>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stockRun, setStockRun] = useState("");
  async function refresh() {
    const [sets, runs, current] = await Promise.all([
      api<InputSet[]>("/api/planning/inputs"),
      api<Execution[]>("/api/planning/executions"),
      api<Job>("/api/job"),
    ]);
    setInputs(sets);
    setExecutions(runs);
    setJob(current);
    setStockRun((id) => id || runs.find((r) => r.state === "done")?.id || "");
  }
  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (job.state !== "running") return;
    const timer = setTimeout(() => {
      refresh().catch((e: Error) => setError(e.message));
    }, 3000);
    return () => clearTimeout(timer);
  }, [job]);
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const done = executions.filter((r) => r.state === "done" && r.summary);
  return (
    <div className="milp-admin">
      <Section
        title="MILP 입력 업로드"
        note="예측 시뮬레이션 입력 · 검증 후 DB 저장 · 계산은 별도 실행"
      >
        <form
          className="milp-upload-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            for (const key of ["nuclear", "coal"])
              if (!(data.get(key) as File)?.size) data.delete(key);
            void action(async () => {
              const saved = await api<InputDetail>(
                "/api/planning/inputs/upload",
                { method: "POST", body: data },
              );
              setSelected(saved);
              await refresh();
              setMessage(`입력 세트 #${saved.id}를 DB에 저장했습니다.`);
            });
          }}
        >
          <label>
            시나리오 JSON
            <input type="file" name="scenario" accept=".json" required />
          </label>
          <label>
            월별 열량단가
            <input
              type="file"
              name="heat_prices"
              accept=".csv,.xlsx,.json"
              required
            />
          </label>
          <label>
            원전 정비 일정 (선택)
            <input type="file" name="nuclear" accept=".csv,.xlsx,.json" />
          </label>
          <label>
            석탄 정비 일정 (선택)
            <input type="file" name="coal" accept=".csv,.xlsx,.json" />
          </label>
          <label>
            연료 환산 기준 (kcal/kg)
            <input
              type="number"
              name="calorific"
              defaultValue={5500}
              min={1000}
              max={10000}
              required
            />
          </label>
          <label>
            기준 발열량 출처
            <select name="assumption" defaultValue="true">
              <option value="true">임시 가정</option>
              <option value="false">사용자 확정값</option>
            </select>
          </label>
          <Button type="submit" disabled={busy}>
            검증 및 DB 저장
          </Button>
        </form>
        <p className="tower-footnote">
          파일당 최대 4MB, 계산 기간은 7일~2년입니다. 정비 파일을 생략하면
          시나리오 JSON의 정비를 사용합니다. 열량단가는 unit, 1월~12월(원/Gcal),
          정비는 unit,start,end,note입니다. 입력 세트와 원본 파일 체크섬을
          보존합니다.
        </p>
      </Section>
      <Section
        title="저장 입력 · 계산 실행"
        note="MIP는 미래 예측용 · 운영 발전량은 내부망 실적 API로 별도 수집"
      >
        <div className="milp-admin-actions">
          <label>
            DB 입력 세트
            <select
              aria-label="DB 입력 세트"
              value={selected?.id ?? ""}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) {
                  setSelected(null);
                  return;
                }
                void action(async () =>
                  setSelected(
                    await api<InputDetail>(`/api/planning/inputs/${id}`),
                  ),
                );
              }}
            >
              <option value="">입력 선택</option>
              {inputs.map((r) => (
                <option value={r.id} key={r.id}>
                  #{r.id} {r.name} · {r.start} ~ {r.end}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void action(refresh)}
          >
            이력 새로고침
          </Button>
          <Button
            disabled={!selected || busy || job.state === "running"}
            onClick={() =>
              void action(async () => {
                const r = await api<{ run_id: string }>("/api/run", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ input_id: selected!.id }),
                });
                await refresh();
                setMessage(`계산 시작: ${r.run_id}`);
              })
            }
          >
            MILP 계산 실행
          </Button>
        </div>
        {selected && (
          <p className="tower-prose">
            {selected.payload.scenario.name} · {selected.payload.scenario.start}{" "}
            ~ {selected.payload.scenario.end} · 원전 정비{" "}
            {selected.payload.scenario.nuclear_oh.length}건 · 석탄 정비{" "}
            {selected.payload.scenario.coal_oh.length}건 · 열량단가{" "}
            {Object.keys(selected.payload.heat_prices).length}개 호기 · 품질{" "}
            {selected.payload.scenario.quality}
          </p>
        )}
        {job.state === "running" && (
          <div role="status">
            <p>
              {job.message ?? "MILP 계산 중"} · {job.windows_done ?? 0} /{" "}
              {job.windows_total ?? "준비 중"} 창 완료
            </p>
            <progress
              value={job.windows_done ?? 0}
              max={job.windows_total ?? 1}
            />
          </div>
        )}
        {job.state === "error" && <p role="alert">계산 실패: {job.error}</p>}
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>실행 · 입력</th>
                <th>상태</th>
                <th>연간 발전량</th>
                <th>결과</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.summary?.scenario.name ?? r.id}
                    <small>
                      입력 #{r.input_id} · {r.id}
                    </small>
                  </td>
                  <td>
                    {r.state === "done"
                      ? "DB 저장 완료"
                      : r.state === "error"
                        ? `실패: ${r.error}`
                        : "계산 중"}
                  </td>
                  <td>{n(r.summary?.annual.dangjin_mwh)} MWh</td>
                  <td>
                    {r.summary && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onResult({
                            id: r.id,
                            start: r.summary!.scenario.start,
                            end: r.summary!.scenario.end,
                          })
                        }
                      >
                        발전소 종합에서 보기
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!executions.length && (
                <tr>
                  <td colSpan={4}>저장된 실행 이력이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="tower-footnote">
          요약·정비·모델 전망과 시간별 발전 결과를 DB에 저장합니다. 근사 해와
          목표 불일치는 발전소 종합에서 확인합니다. 실패한 계산도 이력에
          남습니다.
        </p>
      </Section>
      <Section
        title="시뮬레이션 시작 재고"
        note="선택 계산 시작일 00:00 KST에 귀속 · 현재 운영재고와 분리"
      >
        <form
          className="milp-stock-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const groups = ["g14", "g58", "g910"];
            const payload = {
              run_id: stockRun,
              high_cv: Number(form.get("high_cv")),
              low_cv: Number(form.get("low_cv")),
              high_tonnes: Object.fromEntries(
                groups.map((g) => [g, Number(form.get(`${g}_high`))]),
              ),
              low_tonnes: Object.fromEntries(
                groups.map((g) => [g, Number(form.get(`${g}_low`))]),
              ),
            };
            void action(async () => {
              const saved = await api<{ total_tonnes: number }>(
                "/api/supply/simulation-stock",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                },
              );
              setMessage(
                `가상 시작재고 ${n(saved.total_tonnes)} t를 DB에 저장했습니다.`,
              );
            });
          }}
        >
          <label>
            재고 귀속 계산
            <select
              value={stockRun}
              onChange={(e) => setStockRun(e.target.value)}
              required
            >
              <option value="">완료 계산 선택</option>
              {done.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.summary!.scenario.name} · {r.id}
                </option>
              ))}
            </select>
          </label>
          <div className="milp-upload-form">
            <label>
              고열량 기준 (kcal/kg)
              <input
                name="high_cv"
                type="number"
                min={1000}
                max={10000}
                defaultValue={6000}
                required
              />
            </label>
            <label>
              저열량 기준 (kcal/kg)
              <input
                name="low_cv"
                type="number"
                min={1000}
                max={10000}
                defaultValue={5000}
                required
              />
            </label>
          </div>
          <div className="tower-table-wrap">
            <table className="tower-table">
              <thead>
                <tr>
                  <th>발전처</th>
                  <th>고열량 (t)</th>
                  <th>저열량 (t)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["g14", "1발전처", 50000, 90000],
                  ["g58", "2발전처", 100000, 100000],
                  ["g910", "3발전처", 150000, 150000],
                ].map(([g, label, high, low]) => (
                  <tr key={g}>
                    <td>{label}</td>
                    <td>
                      <input
                        aria-label={`${label} 고열량 재고`}
                        name={`${g}_high`}
                        type="number"
                        min={0}
                        defaultValue={high}
                        required
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${label} 저열량 재고`}
                        name={`${g}_low`}
                        type="number"
                        min={0}
                        defaultValue={low}
                        required
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="submit" disabled={!stockRun || busy}>
            가상 시작재고 DB 등록
          </Button>
        </form>
        <p className="tower-footnote">
          같은 계산의 시작재고는 중복 등록하지 않습니다. 처별 혼합 열량으로
          연료소모를 계산하며, 개별 Pile 적치 위치·성상·센서 값은 별도 자료가
          필요합니다. AIS 입항·체선 화물은 저탄장 재고에 더하지 않고 항내
          잔량으로 구분합니다.
        </p>
      </Section>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
