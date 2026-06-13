import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/cors";
import { getPointsAdjustments, getPointsAdjustmentTotal } from "@/lib/admin/points-products";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const address = String(req.nextUrl.searchParams.get("address") || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return jsonResponse({ luminaNo: null, adjustmentTotal: 0, adjustments: [] }, {
      headers: NO_STORE_HEADERS,
    });
  }

  const user = await db.user.findUnique({ where: { address } });
  const [adjustments, adjustmentTotal] = await Promise.all([
    getPointsAdjustments(address),
    getPointsAdjustmentTotal(address),
  ]);
  const luminaNo = user ? await db.user.count({ where: { createdAt: { lte: user.createdAt } } }) : null;

  return jsonResponse(
    {
      address,
      luminaNo,
      adjustmentTotal,
      adjustments: adjustments.slice(0, 30),
    },
    { headers: NO_STORE_HEADERS },
  );
}
