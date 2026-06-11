import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPointsOrders, openBlindBoxOrder, purchasePointsProduct } from "@/lib/admin/points-products";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return optionsResponse();
}

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:points-orders", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429, headers: NO_STORE_HEADERS });
  }
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return jsonResponse([], { headers: NO_STORE_HEADERS });
  return jsonResponse(await getPointsOrders(address), { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:points-purchase", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "");
  const productId = String(body.productId || "");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return jsonResponse({ error: "Wallet address required." }, { status: 400 });
  if (!productId) return jsonResponse({ error: "Product required." }, { status: 400 });

  try {
    if (body.action === "open") {
      return jsonResponse({ ok: true, ...(await openBlindBoxOrder({ address, productId })) }, { headers: NO_STORE_HEADERS });
    }
    return jsonResponse(
      { ok: true, ...(await purchasePointsProduct({ address, productId, availablePoints: Number(body.availablePoints || 0) })) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Purchase failed." }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
