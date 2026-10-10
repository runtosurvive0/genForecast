import { useState } from "react";
import { Search, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsContent } from "@/components/ui/tabs";
import { Tabs as TabsPrimitive } from "radix-ui";
import { VesselInterestList } from "./VesselInterestList";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import { AisVesselSearch } from "./AisVesselSearch";

export function VesselSearchDialog({
  catalog,
  interests,
  onAdd,
  onRemove,
  theme = "light",
}: {
  catalog: TrackingVessel[];
  interests: string[];
  onAdd: (v: TrackingVessel) => void;
  onRemove: (id: string) => void;
  theme?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const [statusHost, setStatusHost] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState("interests");
  const [message, setMessage] = useState("");
  const [removed, setRemoved] = useState<TrackingVessel | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const matches = catalog.filter((v) =>
    [v.name, v.imo, v.mmsi].some((s) =>
      s.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  function add(v: TrackingVessel) {
    try {
      onAdd(v);
      setMessage(`${v.name} 관심 등록을 반영했습니다.`);
      setRemoved(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록하지 못했습니다.");
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setError("");
        if (value) {
          setTab("interests");
          setMessage("");
          setRemoved(null);
          setQuery("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <ListChecks size={14} aria-hidden="true" />
          관심 선박 구성
        </Button>
      </DialogTrigger>
      <DialogContent className="vessel-workflow-dialog vessel-discovery-dialog">
        <DialogHeader className="vessel-manager-heading">
          <DialogTitle>관심 선박 구성</DialogTitle>
          <DialogDescription>
            관심 선박을 확인하고 관리합니다. 새 선박은 AIS 검색이나 식별자로
            추가할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="vessel-manager-tabs"
        >
          <div className="vessel-manager-tab-row">
            <TabsList aria-label="선박 관리 방법">
              {[
                ["interests", `관심 선박 ${interests.length}`],
                ["ais", "실제 AIS 검색"],
                ["catalog", "목록에서 찾기"],
                ["manual", "직접 등록"],
              ].map(([value, label]) => (
                <TabsPrimitive.Trigger key={value} value={value} asChild>
                  <Button
                    size="sm"
                    variant={tab === value ? "secondary" : "ghost"}
                  >
                    {label}
                  </Button>
                </TabsPrimitive.Trigger>
              ))}
            </TabsList>
            <div className="vessel-manager-status-slot" ref={setStatusHost} />
          </div>
          <TabsContent value="interests">
            <VesselInterestList
              catalog={catalog}
              interests={interests}
              onSearch={() => setTab("ais")}
              onRemove={(vessel) => {
                try {
                  onRemove(vessel.id);
                  setRemoved(vessel);
                  setMessage(
                    `${vessel.name} 관심을 해제했습니다. 항차와 화물은 보존됩니다.`,
                  );
                  setError("");
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "해제하지 못했습니다.",
                  );
                }
              }}
            />
          </TabsContent>
          <TabsContent value="ais">
            <AisVesselSearch
              catalog={catalog}
              interests={interests}
              onAdd={add}
              theme={theme}
              statusHost={statusHost}
            />
          </TabsContent>
          <TabsContent value="manual">
            <form
              className="vessel-workflow-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                add({
                  id: `local-${crypto.randomUUID()}`,
                  name: String(data.get("name")),
                  imo: String(data.get("imo")),
                  mmsi: String(data.get("mmsi")),
                  source: "manual",
                });
              }}
            >
              <label>
                선박명
                <input name="name" required maxLength={100} />
              </label>
              <div className="vessel-workflow-form-row">
                <label>
                  IMO
                  <input
                    name="imo"
                    inputMode="numeric"
                    pattern="[0-9]{7}"
                    maxLength={7}
                    placeholder="7자리"
                  />
                </label>
                <label>
                  MMSI
                  <input
                    name="mmsi"
                    inputMode="numeric"
                    pattern="[0-9]{9}"
                    maxLength={9}
                    placeholder="9자리"
                  />
                </label>
              </div>
              <p className="tower-footnote">
                IMO 또는 MMSI가 필요합니다. 등록 후에도 실제 위치를 받기 전에는
                지도에 배를 만들지 않습니다.
              </p>
              <Button type="submit">위치 연결 대기로 등록</Button>
            </form>
          </TabsContent>
          <TabsContent value="catalog">
            <>
              <label className="vessel-workflow-search">
                <Search size={15} />
                <input
                  aria-label="선박 검색"
                  placeholder="선박명, IMO 또는 MMSI"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="vessel-search-results">
                {matches.map((v) => (
                  <div key={v.id} className="vessel-search-result">
                    <div>
                      <strong>{v.name}</strong>
                      <span>
                        IMO {v.imo || "미확인"} · MMSI {v.mmsi || "미확인"}
                      </span>
                      <small>
                        {v.source === "demo"
                          ? "합성 표본 · 실제 선박 아님"
                          : v.ais
                            ? `${v.source === "digitraffic" ? "Digitraffic · 핀란드" : "AISstream"} · 저장된 관측`
                            : "직접 등록 · 위치 미수신"}
                      </small>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={interests.includes(v.id)}
                      aria-label={`${v.name} 관심 등록`}
                      onClick={() => add(v)}
                    >
                      {interests.includes(v.id) ? "등록됨" : "추가"}
                    </Button>
                  </div>
                ))}
                {!matches.length && (
                  <p className="vessel-workflow-empty">
                    검색 결과가 없습니다. 식별자로 직접 등록할 수 있습니다.
                  </p>
                )}
              </div>
            </>
          </TabsContent>
        </Tabs>
        <div
          className="vessel-manager-feedback"
          role="status"
          aria-live="polite"
        >
          <span>{message}</span>
          {removed && (
            <Button variant="ghost" size="sm" onClick={() => add(removed)}>
              되돌리기
            </Button>
          )}
        </div>
        {error && (
          <p className="vessel-workflow-error" role="alert">
            {error}
          </p>
        )}
        <footer className="vessel-manager-footer">
          <span>변경 사항은 이 브라우저에 저장됩니다.</span>
          <Button size="sm" onClick={() => setOpen(false)}>
            완료
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
