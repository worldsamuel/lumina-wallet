import { PrototypeRuntime } from "./prototype-runtime";
import { MaintenanceGate } from "./maintenance-gate";

type RouteViewProps = {
  view: string;
};

/**
 * Shared App Router bridge for each Lumina v22 prototype view.
 */
export function RouteView({ view }: RouteViewProps) {
  return (
    <MaintenanceGate>
      <PrototypeRuntime initialView={view} />
    </MaintenanceGate>
  );
}
