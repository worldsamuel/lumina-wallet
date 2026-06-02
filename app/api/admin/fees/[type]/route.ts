import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { ensureFeeSchema } from "@/lib/admin/ensure-fee-schema";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { type: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as { percent?: string | number; recipient?: string | null };
  await ensureFeeSchema();
  const fee = await db.feeConfig.upsert({
    where: { businessType: params.type },
    update: {
      percent: body.percent === undefined ? undefined : String(body.percent),
      recipient: body.recipient === undefined ? undefined : body.recipient,
    },
    create: {
      businessType: params.type,
      percent: String(body.percent ?? "0"),
      recipient: body.recipient ?? null,
    },
  });
  await auditLog(admin.id, "update_fee", params.type, body);
  return jsonResponse(fee);
}
