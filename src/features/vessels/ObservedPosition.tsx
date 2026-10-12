import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import { date } from "@/lib/format";
import { describeKoreanPosition } from "./vessel-position-label";

export function ObservedPosition({ position }: { position: NonNullable<TrackingVessel["ais"]>["position"] }) {
  const location = describeKoreanPosition(position);
  if (!position || !location) return null;
  const coordinates = `${position.latitude.toFixed(4)}°N, ${position.longitude.toFixed(4)}°E`;
  return <TooltipProvider delayDuration={300}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="vessel-observed-position">
          {location.stale ? "과거 관측" : "관측 위치"} · {location.label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" sideOffset={6} className="vessel-observed-position-tooltip">
        <div>{coordinates}</div>
        <div>관측 시각 {date(position.observedAt, true)} KST{location.stale ? " · 1시간 초과" : ""}</div>
        <div>등록된 기준점 중 가장 가까운 지점까지의 직선거리입니다.</div>
        <div>해안선 거리·항로 거리·해상 여부를 뜻하지 않습니다.</div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}
