import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { ensureCoreTokens } from "@/lib/admin/ensure-token-schema";
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
      where: { status: { not: "disabled" } },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    console.error("Failed to load public tokens, using core fallback", error);
  }
  const configuredBySymbol = new Map(tokens.map((token) => [token.symbol.toUpperCase(), token]));
  const configuredByAddress = new Set(
    tokens
      .map((token) => token.contractAddr?.toLowerCase())
      .filter((address): address is string => Boolean(address)),
  );
  const coreFallback = TOKENS.filter((token) => {
    if (configuredBySymbol.has(token.symbol.toUpperCase())) return false;
    const address = token.native ? "" : (token.contractAddress ?? token.wrappedAddress ?? "").toLowerCase();
    return !address || !configuredByAddress.has(address);
  }).map((token) => ({
    id: `core-${token.symbol}`,
    symbol: token.symbol,
    name: token.name,
    contractAddr: token.native ? null : (token.contractAddress ?? token.wrappedAddress ?? null),
    poolAddress: null,
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
    await ensureCoreTokens();
  } catch (error) {
    console.error("Failed to ensure public core tokens", error);
  }
}
