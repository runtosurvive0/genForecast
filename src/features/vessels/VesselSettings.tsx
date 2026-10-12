import { SlidersHorizontal, BookmarkMinus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import type { TrackingVessel, TrackingVoyage } from "@/domain/vessel-workflow";
import type { useVesselRoute } from "./useVesselNavigation";
import { VoyageEditor } from "./VoyageEditor";

export function VesselSettings({
  vessel,
  voyage,
  navigation,
  sensitivity,
  setSensitivity,
  onSave,
  onRemove,
}: {
  vessel: TrackingVessel;
  voyage?: TrackingVoyage;
  navigation: ReturnType<typeof useVesselRoute>;
  sensitivity: number;
  setSensitivity: (value: number) => void;
  onSave: (voyage: TrackingVoyage) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="항로·계산 설정">
          <SlidersHorizontal size={15} />
          설정
        </Button>
      </DialogTrigger>
      <DialogContent className="vessel-workflow-dialog vessel-settings-dialog">
        <DialogHeader>
          <DialogTitle>항로·계산 설정</DialogTitle>
          <DialogDescription>
            {vessel.name} · 조회 범위와 시연용 계산 가정을 조정합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="vessel-workflow-form">
          {vessel.source !== "demo" && (
            <>
              <label>
                수집 항적 기간
                <select
                  aria-label="수집 항적 기간"
                  value={navigation.hours}
                  onChange={(e) => navigation.setHours(Number(e.target.value))}
                >
                  <option value={24}>최근 24시간</option>
                  <option value={168}>최근 7일</option>
                  <option value={720}>최근 30일</option>
                </select>
              </label>
              <Button variant="outline" size="sm" onClick={navigation.refresh}>
                항로·항적 갱신
              </Button>
              <label className="vessel-weather-eta-sensitivity">
                기상 보정 민감도 <span>{sensitivity.toFixed(1)}배</span>
                <input
                  aria-label="기상 보정 민감도"
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.5"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                />
              </label>
              <p className="tower-footnote">
                0배는 감속 미적용, 1배는 기본 가정입니다. 현재 선택한
                선박·목적항에만 적용하며, 선박이나 목적항을 바꾸면 기본 가정으로
                돌아갑니다.
              </p>
            </>
          )}
          <div className="vessel-workflow-actions">
            <VoyageEditor
              vessel={vessel}
              voyage={voyage}
              onSave={(value) => {
                onSave(value);
                setOpen(false);
              }}
            />
            <DialogClose asChild>
              <Button variant="ghost" size="sm" onClick={onRemove}>
                <BookmarkMinus size={14} />
                관심 해제
              </Button>
            </DialogClose>
          </div>
          <p className="tower-footnote">
            등록 항차·접안·하역 일정은 별도 가정입니다. ETA나 기상 보정 결과를
            입하·재고 원장에 자동 반영하지 않습니다.
          </p>
        </div>
        <div className="vessel-settings-footer">
          <DialogClose asChild>
            <Button size="sm">완료</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
