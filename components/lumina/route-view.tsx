import { PrototypeRuntime } from "./prototype-runtime";

type RouteViewProps = {
  view: string;
};

/**
 * Shared App Router bridge for each Lumina v22 prototype view.
 */
export function RouteView({ view }: RouteViewProps) {
  return <PrototypeRuntime initialView={view} />;
}
