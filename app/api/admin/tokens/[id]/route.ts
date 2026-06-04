import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { normalizeTokenFields } from "@/lib/admin/token-normalization";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as Record<string, unknown>;
  const current = await db.token.findFirst({ where: { OR: [{ id: params.id }, { symbol: params.id.toUpperCase() }] } });
  if (!current) return jsonResponse({ error: "Token not found." }, { status: 404 });
  const data = normalizeTokenFields({
    symbol: typeof body.symbol === "string" ? body.symbol : current.symbol,
    name: typeof body.name === "string" ? body.name : undefined,
    contractAddr:
      typeof body.contractAddr === "string" || body.contractAddr === null
        ? body.contractAddr
        : undefined,
    poolAddress:
      typeof body.poolAddress === "string" || body.poolAddress === null
        ? body.poolAddress
        : undefined,
    decimals: typeof body.decimals === "number" ? body.decimals : undefined,
    logoUrl: typeof body.logoUrl === "string" || body.logoUrl === null ? body.logoUrl : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    tier: typeof body.tier === "string" ? body.tier : undefined,
    canTransfer: typeof body.canTransfer === "boolean" ? body.canTransfer : undefined,
    canSwap: typeof body.canSwap === "boolean" ? body.canSwap : undefined,
    onTopRanking: typeof body.onTopRanking === "boolean" ? body.onTopRanking : undefined,
  });
  const token = await db.token.update({
    where: { id: current.id },
    data,
  });
  await auditLog(admin.id, "update_token", params.id, body);
  return jsonResponse(token);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const current = await db.token.findFirst({ where: { OR: [{ id: params.id }, { symbol: params.id.toUpperCase() }] } });
  if (!current) return jsonResponse({ error: "Token not found." }, { status: 404 });
  await db.token.delete({ where: { id: current.id } });
  await auditLog(admin.id, "delete_token", params.id);
  return jsonResponse({ ok: true });
}
