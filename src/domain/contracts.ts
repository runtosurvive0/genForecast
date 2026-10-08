/** Integration boundary for future FastAPI / MILP services. No DB access in the UI. */
export interface PlantContract {
  plant_id: string;
  name: string;
  timezone: "Asia/Seoul";
}
export interface UnitContract {
  unit_id: string;
  plant_id: string;
  name: string;
  capacity_mw: number;
  heat_rate_kcal_kwh: number;
}
export interface CargoContract {
  cargo_id: string;
  quantity_t: number;
  coal_type: string;
  calorific_value_kcal_kg: number;
  moisture_pct: number;
  ash_pct: number;
  sulfur_pct: number;
}
export interface GenerationForecast {
  unit_id: string;
  timestamp: string;
  is_on: boolean;
  generation_mw: number;
  reserve_mw: number;
}
export interface DemandForecast {
  date: string;
  average_demand_mw: number;
  peak_demand_mw: number;
  model_version: string;
}
export interface CapacityForecast {
  date: string;
  plant_id: string;
  unit_id: string;
  available_coal_capacity_mw: number;
  model_version: string;
}
export const apiContract = [
  "GET /plants",
  "GET /plants/{plant_id}/summary?horizon_days=30",
  "GET /plants/{plant_id}/units",
  "GET /plants/{plant_id}/inventory/forecast?horizon_days=90",
  "GET /stockpiles?plant_id={plant_id}",
  "GET /stockpiles/{stockpile_id}",
  "GET /vessels?plant_id={plant_id}",
  "GET /vessels/{vessel_id}",
  "GET /vessels/{vessel_id}/track?hours=168",
  "WS /ws/vessels",
  "GET /forecasts/demand?plant_id={plant_id}&horizon_days=90",
  "GET /forecasts/coal-capacity?plant_id={plant_id}&horizon_days=90",
  "GET /model-runs?model_type=demand",
  "GET /alerts?plant_id={plant_id}",
];
