import { useRef, useState } from "react";
import { Minus, Plus, Ship } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TrackingVessel } from "@/domain/vessel-workflow";

export function VesselInterestList({
  catalog,
  interests,
  onSearch,
  onRemove,
}: {
  catalog: TrackingVessel[];
  interests: string[];
  onSearch: () => void;
  onRemove: (vessel: TrackingVessel) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const vessels = interests.flatMap(
    (id) => catalog.find((v) => v.id === id) ?? [],
  );
  const selected = vessels.find((v) => v.id === selectedId);
  return (
    <div className="vessel-manager-list-frame">
      <div
        className="vessel-manager-list"
        role="listbox"
        aria-label="등록된 관심 선박"
        ref={list}
      >
        {vessels.map((vessel, index) => (
          <button
            type="button"
            role="option"
            key={vessel.id}
            aria-selected={selected?.id === vessel.id}
            tabIndex={
              selected
                ? selected.id === vessel.id
                  ? 0
                  : -1
                : index === 0
                  ? 0
                  : -1
            }
            onClick={() => setSelectedId(vessel.id)}
            onKeyDown={(event) => {
              const target =
                event.key === "ArrowDown"
                  ? Math.min(index + 1, vessels.length - 1)
                  : event.key === "ArrowUp"
                    ? Math.max(index - 1, 0)
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? vessels.length - 1
                        : -1;
              if (target < 0) return;
              event.preventDefault();
              setSelectedId(vessels[target].id);
              list.current
                ?.querySelectorAll<HTMLButtonElement>('[role="option"]')
                [target]?.focus();
            }}
          >
            <Ship size={17} aria-hidden="true" />
            <span className="vessel-manager-identity">
              <strong>{vessel.name}</strong>
              <small>
                IMO {vessel.imo || "미확인"} · MMSI {vessel.mmsi || "미확인"}
              </small>
            </span>
            <span className="vessel-manager-source">
              {vessel.source === "demo"
                ? "합성 표본"
                : vessel.source === "manual"
                  ? "직접 등록"
                  : vessel.source === "digitraffic"
                    ? "Digitraffic"
                    : "AISstream"}
            </span>
          </button>
        ))}
        {!vessels.length && (
          <div className="vessel-manager-empty">
            <Ship size={22} />
            <strong>관심 선박이 없습니다</strong>
            <span>아래 + 버튼으로 첫 선박을 찾아보세요.</span>
          </div>
        )}
      </div>
      <div className="vessel-manager-list-toolbar">
        <div role="group" aria-label="관심 목록 편집">
          <Button
            variant="ghost"
            size="icon"
            aria-label="관심 선박 추가 검색"
            title="선박 추가"
            onClick={onSearch}
          >
            <Plus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="선택한 선박 관심 해제"
            title="선택한 선박 관심 해제"
            disabled={!selected}
            onClick={() => {
              if (selected) onRemove(selected);
            }}
          >
            <Minus size={14} />
          </Button>
        </div>
        <span>
          {selected
            ? `${selected.name} 선택됨`
            : "선박을 선택하면 관심을 해제할 수 있습니다."}
        </span>
        <small>{vessels.length}척</small>
      </div>
    </div>
  );
}
