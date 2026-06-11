import { RouteView } from "@/components/lumina/route-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Renders the Lumina v22 home view.
 */
export default function Page() {
  return <RouteView view="home" />;
}
