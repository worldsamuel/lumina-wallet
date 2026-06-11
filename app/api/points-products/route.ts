import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPublicPointsProducts } from "@/lib/admin/points-products";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:points-products", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  return jsonResponse(await getPublicPointsProducts(), {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}
