import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { ensureTokenControlColumns } from "@/lib/admin/ensure-token-schema";
import { db } from "@/lib/db";
import { getWorldChainMarketForToken, getWorldChainMarkets, type WorldChainMarketMode } from "@/lib/market-data";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:tokens-top", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const requestedMode = req.nextUrl.searchParams.get("mode");
  const mode: WorldChainMarketMode =
    requestedMode === "losers" || requestedMode === "new" || requestedMode === "all" ? requestedMode : "gainers";
  await ensureTokenControlColumns().catch((error) => console.error("Failed to ensure token control columns", error));
  const [tokens, configured] = await Promise.all([
    getWorldChainMarkets(mode),
    db.token.findMany({ where: { status: "verified" } }).catch(() => []),
  ]);
  const bySymbol = new Map(configured.map((token) => [token.symbol.toUpperCase(), token]));
  const byAddress = new Map(
    configured
      .map((token) => [token.contractAddr?.toLowerCase(), token] as const)
      .filter((item): item is [string, (typeof configured)[number]] => Boolean(item[0])),
  );
  const merged = tokens.map((token) => {
      const configuredToken =
        byAddress.get(token.address?.toLowerCase() ?? "") ?? bySymbol.get(token.symbol.toUpperCase());
      return configuredToken?.logoUrl || configuredToken?.onTopRanking
        ? {
            ...token,
            logoUrl: configuredToken.logoUrl ?? token.logoUrl,
            verified: true,
          }
        : token;
    });

  if (mode === "all") {
    const seenSymbols = new Set(merged.map((token) => token.symbol.toUpperCase()));
    const seenAddresses = new Set(merged.map((token) => token.address?.toLowerCase()).filter(Boolean));
    const missingConfigured = configured.filter((token) => {
      const address = token.contractAddr?.toLowerCase();
      return (
        token.contractAddr &&
        token.canSwap !== false &&
        (!seenSymbols.has(token.symbol.toUpperCase()) || (address && !seenAddresses.has(address)))
      );
    });
    const recovered = await Promise.all(
      missingConfigured.map(async (token) => {
        const market = await getWorldChainMarketForToken(token.contractAddr!, token.symbol);
        return market
          ? {
              ...market,
              logoUrl: token.logoUrl ?? market.logoUrl,
              verified: true,
            }
          : null;
      }),
    );
    for (const market of recovered) {
      if (!market) continue;
      const address = market.address?.toLowerCase();
      if (seenSymbols.has(market.symbol.toUpperCase()) || (address && seenAddresses.has(address))) continue;
      merged.push(market);
      seenSymbols.add(market.symbol.toUpperCase());
      if (address) seenAddresses.add(address);
    }
  }

  return jsonResponse(merged);
}
