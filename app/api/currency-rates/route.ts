import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { defaultCurrencies } from "@/lib/money-data";

const CONFIG_CACHE = { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } };

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:currency-rates", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const rates = await db.currencyRate.findMany({ orderBy: { code: "asc" } });
    return jsonResponse(rates.length ? rates : defaultCurrencies, CONFIG_CACHE);
  } catch {
    console.warn("[currency-rates] fallback used");
    return jsonResponse(defaultCurrencies, CONFIG_CACHE);
  }
}
