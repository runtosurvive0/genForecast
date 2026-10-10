import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { plants } from "@/domain/operations";
import {
  validateVoyage,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";

const localKst = (value?: string | null) =>
  value &&
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) >= Date.parse("1900-01-01T00:00:00Z") &&
  Date.parse(value) <= Date.parse("2100-12-31T23:59:59Z")
    ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16)
    : "";
export function VoyageEditor({
  vessel,
  voyage,
  onSave,
}: {
  vessel: TrackingVessel;
  voyage?: TrackingVoyage;
  onSave: (v: TrackingVoyage) => void;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setError("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {voyage ? "항차 수정" : "항차 연결"}
        </Button>
      </DialogTrigger>
      <DialogContent className="vessel-workflow-dialog">
        <DialogHeader>
          <DialogTitle>{vessel.name} · 이번 항차</DialogTitle>
          <DialogDescription>
            이 브라우저의 가정 비교용 계획입니다. 팀 입하·재고 원장에는 반영되지
            않습니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="vessel-workflow-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const s = (key: string) => String(form.get(key) ?? "").trim();
            const num = (key: string) => (s(key) ? Number(s(key)) : null);
            const date = (key: string) =>
              s(key) ? `${s(key)}:00+09:00` : null;
            try {
              const plantId = s("plantId");
              onSave(
                validateVoyage({
                  ...voyage,
                  id: voyage?.id ?? `local-voyage-${crypto.randomUUID()}`,
                  vesselId: vessel.id,
                  plantId,
                  origin: s("origin"),
                  destination: `${plants.find((p) => p.id === plantId)!.name} 연료부두`,
                  state: s("state"),
                  etd: date("etd"),
                  plannedEta: date("plannedEta"),
                  distanceNm: num("distance"),
                  plannedSpeedKn: num("speed"),
                  position: voyage?.position ?? null,
                  actualArrivalAt: voyage?.actualArrivalAt ?? null,
                  portWaitH: num("wait"),
                  unloadH: num("unload"),
                  cargoT: num("cargo"),
                  cv: num("cv"),
                }),
              );
              setOpen(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : "저장할 수 없습니다.");
            }
          }}
        >
          <div className="vessel-workflow-form-row">
            <label>
              출항항
              <input
                name="origin"
                defaultValue={voyage?.origin}
                required
                maxLength={160}
              />
            </label>
            <label>
              목적 발전소
              <select
                name="plantId"
                defaultValue={voyage?.plantId ?? "dangjin"}
              >
                {plants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            항차 상태
            <select name="state" defaultValue={voyage?.state ?? "planned"}>
              <option value="planned">출항 예정</option>
              <option value="underway">항해 중</option>
              <option value="stopped">정지·묘박</option>
              {voyage?.state === "arrived" && (
                <option value="arrived">입항 확인</option>
              )}
              <option value="cancelled">취소</option>
            </select>
          </label>
          <div className="vessel-workflow-form-row">
            <label>
              예정 출항 (KST)
              <input
                name="etd"
                type="datetime-local"
                defaultValue={localKst(voyage?.etd)}
              />
            </label>
            <label>
              계획 입항 (KST)
              <input
                name="plannedEta"
                type="datetime-local"
                defaultValue={localKst(voyage?.plannedEta)}
              />
            </label>
          </div>
          <div className="vessel-workflow-form-row">
            <label>
              예상 잔여거리 (nm)
              <input
                name="distance"
                type="number"
                min="0"
                max="30000"
                step="any"
                defaultValue={voyage?.distanceNm ?? ""}
              />
            </label>
            <label>
              계획 항해 속도 (kn)
              <input
                name="speed"
                type="number"
                min="0.1"
                max="50"
                step="any"
                defaultValue={voyage?.plannedSpeedKn ?? ""}
              />
            </label>
          </div>
          <div className="vessel-workflow-form-row">
            <label>
              항만 대기 가정 (h)
              <input
                name="wait"
                type="number"
                min="0"
                max="8760"
                step="any"
                defaultValue={voyage?.portWaitH ?? ""}
              />
            </label>
            <label>
              하역 소요 가정 (h)
              <input
                name="unload"
                type="number"
                min="0"
                max="8760"
                step="any"
                defaultValue={voyage?.unloadH ?? ""}
              />
            </label>
          </div>
          <div className="vessel-workflow-form-row">
            <label>
              화물량 (t)
              <input
                name="cargo"
                type="number"
                min="0"
                max="1000000"
                step="any"
                required
                defaultValue={voyage?.cargoT ?? 0}
              />
            </label>
            <label>
              열량 (kcal/kg)
              <input
                name="cv"
                type="number"
                min="1"
                max="15000"
                step="any"
                required
                defaultValue={voyage?.cv ?? 5500}
              />
            </label>
          </div>
          <p className="tower-footnote">
            거리·속도는 사용자가 확인한 가정입니다. 미입력은 미확정으로
            남습니다. 위치·관측 속도를 임의로 바꾸지는 않습니다.
          </p>
          {error && (
            <p role="alert" className="vessel-workflow-error">
              {error}
            </p>
          )}
          <Button type="submit">이 브라우저에 항차 저장</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
