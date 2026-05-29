import { NextRequest } from "next/server";
import { defaultCurrencies } from "@/lib/money-data";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(_req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  // TODO Replace defaults with an external FX provider.
  const synced = await Promise.all(
    defaultCurrencies.map((currency) =>
      db.currencyRate.upsert({
        where: { code: currency.code },
        update: { name: currency.name, symbol: currency.symbol, rate: String(currency.rate) },
        create: {
          code: currency.code,
          name: currency.name,
          symbol: currency.symbol,
          rate: String(currency.rate),
        },
      }),
    ),
  );
  await auditLog(admin.id, "sync_currency_rates", "all", { count: synced.length });
  return jsonResponse(synced);
}
