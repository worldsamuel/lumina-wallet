import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { deleteEarnProduct, upsertEarnProduct } from "@/lib/admin/earn-products";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { address: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json();
  const products = await upsertEarnProduct({ ...body, address: params.address });
  await auditLog(admin.id, "update_earn_product", params.address, body);
  return jsonResponse(products);
}

export async function DELETE(_req: NextRequest, { params }: { params: { address: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const products = await deleteEarnProduct(params.address);
  await auditLog(admin.id, "delete_earn_product", params.address);
  return jsonResponse(products);
}
