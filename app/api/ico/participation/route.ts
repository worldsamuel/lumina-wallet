import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { recordIcoParticipation } from "@/lib/admin/ico-participation";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:ico-participation", 80).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429, headers: NO_STORE_HEADERS });
  }
  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return jsonResponse({ error: "Wallet address required." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  try {
    const row = await recordIcoParticipation({
      address,
      tokenSymbol: String(body.tokenSymbol || "WLD"),
      tokenAmount: Number(body.tokenAmount || 0),
      luminaAmount: Number(body.luminaAmount || 0),
      txHash: typeof body.txHash === "string" ? body.txHash : null,
    });
    return jsonResponse({ ok: true, row }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "ICO record failed." }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
