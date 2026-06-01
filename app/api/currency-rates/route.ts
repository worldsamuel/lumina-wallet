import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { defaultCurrencies } from "@/lib/money-data";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:currency-rates", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const rates = await db.currencyRate.findMany({ orderBy: { code: "asc" } });
    return jsonResponse(rates.length ? rates : defaultCurrencies);
  } catch (error) {
    console.error("Failed to load currency rates, using fallback", error);
    return jsonResponse(defaultCurrencies);
  }
}
