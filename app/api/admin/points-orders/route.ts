import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getAllPointsOrders, updatePointsOrderRedemption } from "@/lib/admin/points-products";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  return jsonResponse(await getAllPointsOrders());
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await req.json();
    const order = await updatePointsOrderRedemption({
      id: String(body?.id || ""),
      redeemed: body?.redeemed === true,
      redeemedBy: admin.username || admin.id || "admin",
    });
    return jsonResponse({ ok: true, order });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Failed to update order." }, { status: 400 });
  }
}
