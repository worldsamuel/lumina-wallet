import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { addPointsAdjustment, getPointsAdjustments, getPointsAdjustmentTotal } from "@/lib/admin/points-products";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(_: Request, ctx: { params: { address: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const address = decodeURIComponent(ctx.params.address || "").toLowerCase();
  const rows = await getPointsAdjustments(address);
  return jsonResponse({ address, total: await getPointsAdjustmentTotal(address), rows });
}

export async function POST(req: Request, ctx: { params: { address: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const address = decodeURIComponent(ctx.params.address || "").toLowerCase();
  const body = await req.json().catch(() => ({}));
  try {
    const row = await addPointsAdjustment({
      address,
      points: Number(body.points || 0),
      note: typeof body.note === "string" ? body.note : null,
      createdBy: admin.username,
    });
    await auditLog(admin.id, "adjust_user_points", address, row);
    return jsonResponse({ ok: true, row, total: await getPointsAdjustmentTotal(address), rows: await getPointsAdjustments(address) });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Failed to adjust points." }, { status: 400 });
  }
}
