import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { airdropBlindBox } from "@/lib/admin/points-products";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await airdropBlindBox({
      address: String(body.address || ""),
      productId: String(body.productId || ""),
      note: typeof body.note === "string" ? body.note : null,
      createdBy: admin.username,
    });
    await auditLog(admin.id, "airdrop_blind_box", body.address || null, result);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Failed to airdrop blind box." }, { status: 400 });
  }
}
