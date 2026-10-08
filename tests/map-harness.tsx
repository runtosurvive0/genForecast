import { useState } from "react";
import { createRoot } from "react-dom/client";
import { VesselMap } from "../src/features/vessels/VesselMap";
import { plants, shipments } from "../src/domain/operations";
import "../src/index.css";
import "../src/refinement.css";
const fleet = Array.from({ length: 200 }, (_, i) => ({
  ...shipments[0],
  id: `test-${i}`,
  vesselName: `Test vessel ${i}`,
}));
const positions = fleet.map((s, i) => ({
  vessel_id: s.id,
  longitude: -170 + (i % 20) * 17,
  latitude: -65 + Math.floor(i / 20) * 13,
  received_at: "2026-10-01T00:00:00Z",
}));
function Harness() {
  const [id, setId] = useState<string | null>(null);
  return (
    <VesselMap
      shipments={fleet}
      positions={positions}
      plants={plants}
      selectedVesselId={id}
      onSelect={setId}
      theme="light"
    />
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
