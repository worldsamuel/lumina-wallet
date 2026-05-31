import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getEarnProductsWithLiveData, upsertEarnProduct } from "@/lib/admin/earn-products";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  return jsonResponse(await getEarnProductsWithLiveData());
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json();
  if (!body?.address) return jsonResponse({ error: "Vault address is required." }, { status: 400 });
  const products = await upsertEarnProduct(body);
  await auditLog(admin.id, "upsert_earn_product", body.address, body);
  return jsonResponse(products);
}
