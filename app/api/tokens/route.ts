import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { TOKENS } from "@/lib/tokens";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:tokens", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  await ensurePublicCoreTokens();
  let tokens: Awaited<ReturnType<typeof db.token.findMany>> = [];
  try {
    tokens = await db.token.findMany({
      where: { status: "verified" },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    console.error("Failed to load public tokens, using core fallback", error);
  }
  const configured = new Map(tokens.map((token) => [token.symbol.toUpperCase(), token]));
  const coreFallback = TOKENS.filter((token) => !configured.has(token.symbol.toUpperCase())).map((token) => ({
    id: `core-${token.symbol}`,
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
    createdAt: new Date(0).toISOString(),
  }));
  return jsonResponse([...coreFallback, ...tokens]);
}

async function ensurePublicCoreTokens() {
  try {
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
  } catch (error) {
    console.error("Failed to ensure public core tokens", error);
  }
}
