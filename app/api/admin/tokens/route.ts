import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";
import { TOKENS } from "@/lib/tokens";

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
  return jsonResponse(tokens);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as {
    symbol: string;
    name: string;
    contractAddr?: string | null;
    decimals?: number;
    logoUrl?: string | null;
    status?: string;
    tier?: string;
    canTransfer?: boolean;
    canSwap?: boolean;
    onTopRanking?: boolean;
  };

  const token = await db.token.create({
    data: {
      symbol: body.symbol,
      name: body.name,
      contractAddr: body.contractAddr ?? null,
      decimals: body.decimals ?? 18,
      logoUrl: body.logoUrl ?? null,
      status: body.status ?? "pending",
      tier: body.tier ?? "community",
      canTransfer: body.canTransfer ?? true,
      canSwap: body.canSwap ?? true,
      onTopRanking: body.onTopRanking ?? false,
    },
  });
  await auditLog(admin.id, "create_token", token.id, body);
  return jsonResponse(token);
}

async function ensureCoreTokens() {
  for (const token of TOKENS) {
    await db.token.upsert({
      where: { symbol: token.symbol },
      update: {
        name: token.name,
        contractAddr: token.contractAddress ?? token.wrappedAddress ?? null,
        decimals: token.decimals,
        status: "verified",
        tier: "core",
        canTransfer: true,
        canSwap: true,
      },
      create: {
        symbol: token.symbol,
        name: token.name,
        contractAddr: token.contractAddress ?? token.wrappedAddress ?? null,
        decimals: token.decimals,
        logoUrl: null,
        status: "verified",
        tier: "core",
        canTransfer: true,
        canSwap: true,
        onTopRanking: token.symbol === "WLD",
      },
    });
  }
}
