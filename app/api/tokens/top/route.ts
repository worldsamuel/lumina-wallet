import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:tokens-top", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const tokens = await db.token.findMany({
    where: { status: "verified", onTopRanking: true },
    orderBy: { createdAt: "asc" },
  });
  return jsonResponse(tokens);
}
