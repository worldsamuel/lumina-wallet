import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getPointsAdjustments, getPointsAdjustmentTotal } from "@/lib/admin/points-products";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { address: { contains: q, mode: "insensitive" } },
            { worldId: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const enriched = await Promise.all(users.map(async (user) => {
    const [adjustments, adjustmentTotal] = await Promise.all([
      getPointsAdjustments(user.address),
      getPointsAdjustmentTotal(user.address),
    ]);
    return {
      ...user,
      luminaNo: await db.user.count({ where: { createdAt: { lte: user.createdAt } } }),
      pointsAdjustmentTotal: adjustmentTotal,
      pointsAdjustments: adjustments.slice(0, 12),
    };
  }));
  return jsonResponse(enriched);
}
