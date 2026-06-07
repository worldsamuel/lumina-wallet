import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getPointsProducts, upsertPointsProduct } from "@/lib/admin/points-products";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  return jsonResponse(await getPointsProducts());
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json();
  if (!body?.title) return jsonResponse({ error: "Product title is required." }, { status: 400 });
  const products = await upsertPointsProduct(body);
  await auditLog(admin.id, "upsert_points_product", body.id || body.title, body);
  return jsonResponse(products);
}
