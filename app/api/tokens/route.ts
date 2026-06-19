import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { ensureCoreTokens } from "@/lib/admin/ensure-token-schema";
import { db } from "@/lib/db";
import { TOKENS } from "@/lib/tokens";

const TOKEN_CACHE_TTL_MS = 5_000;
const TOKEN_CACHE_HEADERS = {
  headers: {
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  },
};
let cachedTokens: { expiresAt: number; data: unknown[] } | null = null;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:tokens", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  if (cachedTokens && cachedTokens.expiresAt > Date.now()) {
    return jsonResponse(cachedTokens.data, TOKEN_CACHE_HEADERS);
  }

  await ensurePublicCoreTokens();
  let tokens: Awaited<ReturnType<typeof db.token.findMany>> = [];
  try {
    tokens = await db.token.findMany({
      where: { status: { not: "disabled" } },
      orderBy: { createdAt: "asc" },
    });
  } catch {
    console.warn("[tokens] fallback used");
  }
  const allConfigured = await db.token.findMany().catch(() => tokens);
  const configuredBySymbol = new Map(allConfigured.map((token) => [token.symbol.toUpperCase(), token]));
  const configuredByAddress = new Set(
    allConfigured
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
  const data = [...coreFallback, ...tokens];
  cachedTokens = { data, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS };
  return jsonResponse(data, TOKEN_CACHE_HEADERS);
}

async function ensurePublicCoreTokens() {
  try {
    await ensureCoreTokens();
  } catch {
    console.warn("[tokens] core ensure failed");
  }
}
