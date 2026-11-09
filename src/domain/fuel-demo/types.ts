export type FuelDemoStatus =
  "disabled" | "connecting" | "online" | "stale" | "disconnected";
export type FuelDemoRole = "viewer" | "controller";
export type FuelDemoRunStatus = "running" | "stopped" | "fault";
export type FuelDemoWorkKind = "unload" | "reclaim";
export interface FuelDemoPose {
  x: number;
  z: number;
  angle: number;
  target: number[];
  position: number;
}
export interface FuelDemoLot {
  id: string;
  uiId: string;
  yard: number;
  pile: number | null;
  endpoint: string;
  coal: string;
  quality: string;
  tons: number;
  usable: boolean;
  reclaimRoute: string[] | null;
  poses: Record<FuelDemoWorkKind, FuelDemoPose>;
}
export interface FuelDemoEquipment {
  id: string;
  code: string;
  name: string;
  kind: string;
  group: string;
}
export interface FuelDemoCatalog {
  materialLots: FuelDemoLot[];
  equipment: FuelDemoEquipment[];
  units: Array<{ id: number; mw: number; maxMW: number }>;
  routes: Array<{
    berth: number;
    endpoints: Array<{ id: string; label: string; assets: string[] }>;
  }>;
}
export interface FuelDemoWork {
  kind: FuelDemoWorkKind;
  running: boolean;
  lotId: string;
  berth: number | null;
  rate: number;
  route: string[];
  machine: string;
  pose: FuelDemoPose;
  amount: number;
  moved: number;
  siloId?: string | null;
  actualRate: number;
  reason: string;
}
export interface FuelDemoSnapshot {
  source: "demo";
  elapsed: number;
  playing: boolean;
  speed: number;
  baseTime: string;
  material: {
    lots: Record<
      string,
      FuelDemoLot & {
        baseTons: number;
        received: number;
        reclaimed: number;
        demoLabel?: string;
      }
    >;
    ships: Record<
      string,
      { name: string; total: number; remaining: number; unloaded: number }
    >;
    jobs: Record<FuelDemoWorkKind, FuelDemoWork | null>;
    received: number;
    outbound: number;
    totalStock: number;
    baselineStock: number;
  };
  equipment: Record<
    string,
    {
      status: FuelDemoRunStatus;
      setFlow: number;
      flow: number;
      position: number;
    }
  >;
  units: Record<
    string,
    { status: FuelDemoRunStatus; setMW: number; mw: number }
  >;
  silos?: Record<string, {tonnes:number; capacity:number; status:FuelDemoRunStatus; setRate:number; actualRate:number; speedPercent?:number; consumed:number; received:number}>;
  schedule: Array<{
    id: number;
    at: number;
    duration: number;
    action: FuelDemoAction;
    status: "pending" | "done" | "cancelled" | "failed";
  }>;
  events: Array<{ id: number; at: number; message: string; kind: string }>;
  ramps: number;
}
export type FuelDemoAction =
  | {op:'feeder'; id:string; patch:{status?:FuelDemoRunStatus; rate?:number}}
  | {
      op: "equipment";
      id: string;
      patch: { status?: FuelDemoRunStatus; flow?: number; position?: number };
    }
  | {
      op: "unit";
      id: number;
      patch: { status?: FuelDemoRunStatus; mw?: number };
    };
export type FuelDemoCommand =
  | FuelDemoAction
  | {op:'silo'; id:string; patch:{tonnes?:number; capacity?:number}}
  | { op: "play" | "pause" | "reset" | "preset" }
  | { op: "speed"; value: number }
  | { op: "schedule"; delay: number; duration: number; action: FuelDemoAction }
  | { op: "cancel"; id: number }
  | {
      op: "work";
      kind: FuelDemoWorkKind;
      running: boolean;
      lotId?: string;
      berth?: number;
      rate?: number;
      amount?: number;
      siloId?: string;
    };
export interface FuelDemoAck {
  type: "ack";
  id: string;
  ok: true;
  seq: number;
}
export interface FuelDemoConnectionState {
  status: FuelDemoStatus;
  snapshot: FuelDemoSnapshot | null;
  catalog: FuelDemoCatalog | null;
  receivedAt: number;
  serverId: string | null;
}
export interface FuelDemoValue extends FuelDemoConnectionState {
  command: (command: FuelDemoCommand) => Promise<FuelDemoAck>;
}
