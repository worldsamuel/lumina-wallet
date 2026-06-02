import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { DEFAULT_FEE_CONFIGS, ensureDefaultFees } from "@/lib/admin/ensure-fee-schema";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:fees", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  try {
    await ensureDefaultFees();
    const fees = await db.feeConfig.findMany({ orderBy: { businessType: "asc" } });
    return jsonResponse(fees);
  } catch (error) {
    console.error("Failed to load fee configs, using defaults", error);
    return jsonResponse(DEFAULT_FEE_CONFIGS);
  }
}
