import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { ensureCoreTokens } from "@/lib/admin/ensure-token-schema";
import { normalizeTokenFields } from "@/lib/admin/token-normalization";
import { applySellRouteValidation } from "@/lib/admin/token-swap-validation";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  await ensureCoreTokens();
  const tokens = await db.token.findMany({
    orderBy: { createdAt: "asc" },
  });
  return jsonResponse(tokens, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as {
    symbol: string;
    name: string;
    contractAddr?: string | null;
    poolAddress?: string | null;
    decimals?: number;
    logoUrl?: string | null;
    status?: string;
    tier?: string;
    canTransfer?: boolean;
    canSwap?: boolean;
    onTopRanking?: boolean;
  };

  const normalized = normalizeTokenFields({
    symbol: body.symbol,
    name: body.name,
    contractAddr: body.contractAddr ?? null,
    poolAddress: body.poolAddress ?? null,
    decimals: body.decimals ?? 18,
    logoUrl: body.logoUrl ?? null,
    status: body.status ?? "pending",
    tier: body.tier ?? "community",
    canTransfer: body.canTransfer ?? true,
    canSwap: body.canSwap ?? true,
    onTopRanking: body.onTopRanking ?? false,
  });
  const data = await applySellRouteValidation(normalized);
  const token = await db.token.create({
    data,
  });
  await auditLog(admin.id, "create_token", token.id, body);
  return jsonResponse(token);
}
