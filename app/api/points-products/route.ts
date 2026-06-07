import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPublicPointsProducts } from "@/lib/admin/points-products";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:points-products", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  return jsonResponse(await getPublicPointsProducts());
}
