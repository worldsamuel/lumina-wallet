import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { assertAlphaBlindBoxEligibility, spendAlphaBlindBoxPoints } from "@/lib/admin/alpha-points";
import { getPointsOrders, getPublicPointsProducts, openBlindBoxOrder, purchasePointsProduct } from "@/lib/admin/points-products";

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
    return jsonResponse({ error: "Too many requests." }, { status: 429, headers: NO_STORE_HEADERS });
  }
  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "");
  const productId = String(body.productId || "");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return jsonResponse({ error: "Wallet address required." }, { status: 400 });
  if (!productId) return jsonResponse({ error: "Product required." }, { status: 400 });

  try {
    const product = (await getPublicPointsProducts()).find((item) => item.id === productId);
    const alphaProduct = product?.type === "blind_box" && product.alphaRequired === true;
    if (alphaProduct && (body.action !== "open" || body.allowPurchase === true)) {
      await assertAlphaBlindBoxEligibility(address);
    }
    if (body.action === "open") {
      const result = await openBlindBoxOrder({
        address,
        productId,
        availablePoints: Number(body.availablePoints || 0),
        clientOrderId: typeof body.clientOrderId === "string" ? body.clientOrderId : null,
        allowPurchase: body.allowPurchase === true,
        skipPointDebit: alphaProduct,
      });
      if (alphaProduct && body.allowPurchase === true) {
        await spendAlphaBlindBoxPoints({
          address,
          orderId: result.order.id,
          productTitle: result.product.title,
        });
      }
      return jsonResponse(
        {
          ok: true,
          ...result,
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    return jsonResponse(
      {
        ok: true,
        ...(await (async () => {
          const result = await purchasePointsProduct({
            address,
            productId,
            availablePoints: Number(body.availablePoints || 0),
            clientOrderId: typeof body.clientOrderId === "string" ? body.clientOrderId : null,
            skipPointDebit: alphaProduct,
          });
          if (alphaProduct) {
            await spendAlphaBlindBoxPoints({
              address,
              orderId: result.order.id,
              productTitle: result.product.title,
            });
          }
          return result;
        })()),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Purchase failed." }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
