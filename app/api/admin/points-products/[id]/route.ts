import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { deletePointsProduct, upsertPointsProduct } from "@/lib/admin/points-products";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json();
  const products = await upsertPointsProduct({ ...body, id: params.id });
  await auditLog(admin.id, "update_points_product", params.id, body);
  return jsonResponse(products);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const products = await deletePointsProduct(params.id);
  await auditLog(admin.id, "delete_points_product", params.id);
  return jsonResponse(products);
}
