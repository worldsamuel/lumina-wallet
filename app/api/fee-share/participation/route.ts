import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { recordFeeShareParticipation } from "@/lib/admin/fee-share";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:fee-share-participation", 12).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const row = await recordFeeShareParticipation({
      address: body.address,
      amountWld: body.amountWld,
      txHash: body.txHash,
    });
    return jsonResponse({ ok: true, row }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Fee share record failed." }, { status: 400 });
  }
}
