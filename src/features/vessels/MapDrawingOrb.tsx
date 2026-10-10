import { useEffect, useState } from "react";
import { ProcessingOrb } from "@/components/ProcessingOrb";

export function MapDrawingOrb({ busy, theme }: { busy: boolean; theme: "light" | "dark" }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    // Cached tiles normally finish before this: avoid a flash on every gesture.
    const timer = window.setTimeout(() => setVisible(true), 250);
    return () => window.clearTimeout(timer);
  }, [busy]);
  return busy && visible ? (
    <ProcessingOrb theme={theme} state="solving" size={32}
      label="지도 그리는 중" className="vessel-map-drawing" />
  ) : null;
}
