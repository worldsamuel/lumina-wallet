import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as { name?: string; symbol?: string; rate?: string | number };
  const rate = await db.currencyRate.update({
    where: { code: params.code.toUpperCase() },
    data: {
      name: body.name,
      symbol: body.symbol,
      rate: body.rate === undefined ? undefined : String(body.rate),
    },
  });
  await auditLog(admin.id, "update_currency_rate", params.code.toUpperCase(), body);
  return jsonResponse(rate);
}
