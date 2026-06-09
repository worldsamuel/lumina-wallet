import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { ensureTokenControlColumns } from "@/lib/admin/ensure-token-schema";
import { db } from "@/lib/db";
import { getWorldChainMarketForToken, getWorldChainMarkets, type WorldChainMarketMode } from "@/lib/market-data";

const MARKET_CACHE = { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } };

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
  await ensureTokenControlColumns().catch(() => console.warn("[tokens/top] control column ensure failed"));
  const [tokens, configured] = await Promise.all([
    getWorldChainMarkets(mode),
    db.token.findMany().catch(() => []),
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
      if (configuredToken?.status === "disabled" || configuredToken?.canSwap === false) return null;
      const configuredAddress = configuredToken?.contractAddr?.toLowerCase();
      if (
        configuredAddress &&
        token.address &&
        token.address.toLowerCase() !== configuredAddress &&
        configuredToken?.symbol.toUpperCase() === token.symbol.toUpperCase()
      ) {
        return null;
      }
      return configuredToken
        ? {
            ...token,
            logoUrl: configuredToken.logoUrl ?? token.logoUrl,
            poolAddress: configuredToken.poolAddress || token.poolAddress,
            status: configuredToken.status,
            verified: configuredToken.status === "verified",
          }
        : token;
    }).filter((token): token is (typeof tokens)[number] => Boolean(token));

  if (mode === "all") {
    const seenSymbols = new Set(merged.map((token) => token.symbol.toUpperCase()));
    const seenAddresses = new Set(merged.map((token) => token.address?.toLowerCase()).filter(Boolean));
    const missingConfigured = configured.filter((token) => {
      const address = token.contractAddr?.toLowerCase();
      return (
        token.contractAddr &&
        token.canSwap !== false &&
        token.status !== "disabled" &&
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
              poolAddress: token.poolAddress || market.poolAddress,
              status: token.status,
              verified: token.status === "verified",
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

  return jsonResponse(merged, MARKET_CACHE);
}
