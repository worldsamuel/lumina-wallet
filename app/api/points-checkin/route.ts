import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { awardRulePoints } from "@/lib/admin/points-products";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:points-checkin", 30).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "").toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  try {
    const result = await awardRulePoints({
      address,
      kind: "checkin",
      note: "Daily check-in",
      uniqueKey: `points-rule:checkin:${day}`,
    });
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Check-in failed." }, { status: 400 });
  }
}
