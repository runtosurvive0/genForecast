import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export type VesselDataTab = "ais" | "ports" | "weather" | "basis";
export function VesselDataDetails({
  open,
  onOpenChange,
  tab,
  onTabChange,
  observation,
  ports,
  weather,
  basis,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: VesselDataTab;
  onTabChange: (tab: VesselDataTab) => void;
  observation: ReactNode;
  ports?: ReactNode;
  weather: ReactNode;
  basis: ReactNode;
}) {
  return (
    <details
      className="vessel-data-details"
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
    >
      <summary>
        <ChevronRight size={14} />
        <span>자료·계산 근거</span>
      </summary>
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as VesselDataTab)}
      >
        <TabsList aria-label="선박 자료 종류">
          <TabsTrigger value="ais">AIS 관측</TabsTrigger>
          {ports && <TabsTrigger value="ports">과거 기항</TabsTrigger>}
          <TabsTrigger value="weather">기상 상세</TabsTrigger>
          <TabsTrigger value="basis">계산 근거</TabsTrigger>
        </TabsList>
        <TabsContent value="ais" forceMount>
          {observation}
        </TabsContent>
        {ports && (
          <TabsContent value="ports" forceMount>
            {ports}
          </TabsContent>
        )}
        <TabsContent value="weather" forceMount>
          {weather}
        </TabsContent>
        <TabsContent value="basis" forceMount>
          {basis}
        </TabsContent>
      </Tabs>
    </details>
  );
}
