import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getAllPointsOrders, getPointsAdjustments, getPointsAdjustmentTotal } from "@/lib/admin/points-products";
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
  const [allAdjustments, allOrders] = await Promise.all([
    getPointsAdjustments(),
    getAllPointsOrders(),
  ]);
  const byAddress = new Map<string, {
    id: string | number;
    address: string;
    worldId?: string | null;
    createdAt: Date;
    lastLoginAt?: Date | null;
  }>();
  for (const user of users) {
    byAddress.set(user.address.toLowerCase(), {
      id: user.id,
      address: user.address.toLowerCase(),
      worldId: user.worldId,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    });
  }
  const addSynthetic = (address: string, createdAt?: string) => {
    const normalized = String(address || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized) || byAddress.has(normalized)) return;
    byAddress.set(normalized, {
      id: `address-${normalized}`,
      address: normalized,
      worldId: null,
      createdAt: createdAt ? new Date(createdAt) : new Date(0),
      lastLoginAt: null,
    });
  };
  for (const row of allAdjustments) addSynthetic(row.address, row.createdAt);
  for (const row of allOrders) addSynthetic(row.address, row.createdAt);
  const merged = Array.from(byAddress.values())
    .filter((user) => {
      if (!q) return true;
      return [user.address, user.worldId || ""].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 1000);
  const enriched = await Promise.all(merged.map(async (user, index) => {
    const [adjustments, adjustmentTotal] = await Promise.all([
      getPointsAdjustments(user.address),
      getPointsAdjustmentTotal(user.address),
    ]);
    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      luminaNo: index + 1,
      pointsAdjustmentTotal: adjustmentTotal,
      pointsAdjustments: adjustments.slice(0, 12),
    };
  }));
  return jsonResponse(enriched);
}
