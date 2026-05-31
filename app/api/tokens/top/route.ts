import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { getWorldChainMarkets, type WorldChainMarketMode } from "@/lib/market-data";

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
  return jsonResponse(
    tokens.map((token) => {
      const configuredToken =
        byAddress.get(token.address?.toLowerCase() ?? "") ?? bySymbol.get(token.symbol.toUpperCase());
      return configuredToken?.logoUrl || configuredToken?.onTopRanking
        ? {
            ...token,
            logoUrl: configuredToken.logoUrl ?? token.logoUrl,
            verified: true,
          }
        : token;
    }),
  );
}
