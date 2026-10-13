import { Button } from "@/components/ui/button";
import { stockpiles, voyages } from "@/data/control-tower";
import { apiContract } from "@/domain/contracts";
import { BASE_TIME, type Plant } from "@/domain/operations";
import { number as n, date as fmtDate } from "@/lib/format";
import { Section } from "@/components/tower/primitives";
import "./data.css";
import { useEffect, useState } from "react";
import { MilpUpload } from "./MilpUpload";
import { BerthPlanning } from "./BerthPlanning";
import type { PlanningState } from "@/domain/use-planning";

export function DataPage({
  plants,
  onResult,
  planning,
  onPlanningEnabled,
}: {
  plants: Plant[];
  onResult: (run: { id: string; start: string; end: string }) => void;
  planning: PlanningState;
  onPlanningEnabled: (enabled: boolean) => void;
}) {
  const [tab, setTab] = useState<"status" | "upload" | "berths">("status");
  useEffect(() => {
    onPlanningEnabled(tab === "berths");
    return () => onPlanningEnabled(false);
  }, [tab, onPlanningEnabled]);
  const ids = plants.map((p) => p.id);
  const piles = stockpiles.filter((p) => ids.includes(p.plant_id));
  const cargo = voyages.filter((v) => ids.includes(v.destination_plant_id));
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            source: "SYNTHETIC",
            base_time: BASE_TIME,
            plants,
            stockpiles: piles,
            voyages: cargo,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ewp-poc-data.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="tower-page">
      <div className="milp-admin-tabs" role="tablist" aria-label="데이터 관리">
        <button
          role="tab"
          aria-selected={tab === "status"}
          onClick={() => setTab("status")}
        >
          데이터 연결 상태
        </button>
        <button
          role="tab"
          aria-selected={tab === "upload"}
          onClick={() => setTab("upload")}
        >
          MILP 업로드
        </button>
        <button
          role="tab"
          aria-selected={tab === "berths"}
          onClick={() => setTab("berths")}
        >
          수급 배정·시뮬레이션
        </button>
      </div>
      {tab === "berths" ? (
        <BerthPlanning planning={planning} />
      ) : tab === "upload" ? (
        <MilpUpload onResult={onResult} />
      ) : (
        <>
          <Section
            title="데이터 연결 상태"
            note="표본 데이터 점검 · MILP 입력·실행 DB는 업로드 탭에서 관리합니다"
            action={
              <Button variant="outline" size="sm" onClick={download}>
                더미데이터 내려받기
              </Button>
            }
          >
            <div className="tower-table-wrap">
              <table className="tower-table">
                <thead>
                  <tr>
                    <th>데이터</th>
                    <th>현재 공급원</th>
                    <th>상태</th>
                    <th>후속 연결</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      "재고·탄질·Pile",
                      "로컬 더미 " + piles.length + "건",
                      "DEMO",
                      "재고 DB / SQLAlchemy",
                    ],
                    [
                      "선박·화물",
                      "로컬 더미 " + cargo.length + "건",
                      "DEMO",
                      "AISstream 서버 프록시",
                    ],
                    ["온도·CO", "없음", "미연결", "저탄장 센서"],
                    [
                      "수요·공급 모델",
                      "브라우저 합성데이터 학습",
                      "LOCAL",
                      "FastAPI / Python 모델 서비스",
                    ],
                    [
                      "발전량 최적화",
                      "Python MILP · 프로젝트 DB",
                      "API",
                      "MILP 업로드 · 예측 시뮬레이션",
                    ],
                  ].map((row) => (
                    <tr key={row[0]}>
                      {row.map((x, i) => (
                        <td key={i}>{x}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="정합성 점검" note="선택한 발전소 범위에 적용">
            <dl className="tower-details">
              <div>
                <dt>Pile 합계</dt>
                <dd>{n(piles.reduce((s, p) => s + p.on_hand_t, 0))} t</dd>
              </div>
              <div>
                <dt>화물 합계 (전체 항차)</dt>
                <dd>{n(cargo.reduce((s, v) => s + v.cargo_t, 0))} t</dd>
              </div>
              <div>
                <dt>발전소 키</dt>
                <dd>{ids.join(", ")}</dd>
              </div>
              <div>
                <dt>데이터 기준시각</dt>
                <dd>{fmtDate(BASE_TIME, true)}</dd>
              </div>
            </dl>
            <p className="tower-footnote">
              입하 예정 KPI는 선택 기간 안에 하역이 끝나는 화물만 집계합니다.
              발전소 키로 재고·Pile·항차·호기를 연결하며, AIS 최신성은 현재
              시각으로 판정합니다.
            </p>
          </Section>
          <Section
            title="서비스 연동 범위"
            note="표본 조회와 MILP 입력·결과 DB 연결을 구분합니다"
          >
            <p className="tower-prose">
              화면 계산과 외부 데이터 공급원을 분리했습니다. AIS는 서버에서 키를
              보관하고 정규화한 위치 정보를 페이지로 전달하는 구조입니다. 예측
              서비스는 날짜·호기별 발전량을 같은 재고 엔진에 전달할 수 있습니다.
            </p>
            <p className="tower-prose">
              MILP 업로드 탭에서 입력과 실행 결과를 프로젝트 DB에 저장합니다.
              내부망 발전 실적과 AIS 입항·체선 자료는 정규화 API 경계를
              제공하며, 실제 수집 시스템 연결·인증·운영자료 검증은 후속
              작업입니다.
            </p>
            <details className="tower-api">
              <summary>API 계약 보기 · /api/v1 (미연결)</summary>
              {apiContract.map((route) => (
                <code key={route}>{route}</code>
              ))}
            </details>
          </Section>
        </>
      )}
    </div>
  );
}
