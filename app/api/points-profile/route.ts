import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/cors";
import { getPointsAdjustments, getPointsAdjustmentTotal } from "@/lib/admin/points-products";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const address = String(req.nextUrl.searchParams.get("address") || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return jsonResponse({ luminaNo: null, adjustmentTotal: 0, adjustments: [] }, {
      headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" },
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
    { headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
  );
}
