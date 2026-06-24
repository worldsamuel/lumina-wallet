import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getStoredActivities } from "@/lib/admin/activity-store";
import { normalizeAlphaRules } from "@/lib/admin/alpha-config";
import { getAllPointsOrders, getPointsAdjustments } from "@/lib/admin/points-products";
import { getSystemConfig, updateSystemConfig } from "@/lib/admin/system-config";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

type AlphaRow = {
  address: string;
  score: number;
  balanceScore: number;
  swapScore: number;
  recentSwapOk: boolean;
  spendPoints: number;
  boxesOpened: number;
  boxesPending: number;
  lastActivityAt: string | null;
};

function startOfRollingWindow(days: number) {
  const start = new Date();
  start.setDate(start.getDate() - Math.max(0, days - 1));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function rowTime(value?: string | Date | null) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function positivePoints(value: unknown) {
  const points = Math.floor(Number(value || 0));
  return points > 0 ? points : 0;
}

function isAlpha(kind: "balance" | "swap" | null, createdBy?: string | null) {
  const prefix = kind ? `alpha:${kind}:` : "alpha:";
  return String(createdBy || "").startsWith(prefix);
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const systemConfig = await getSystemConfig();
  const alphaRules = normalizeAlphaRules(systemConfig.alphaRules);

  const [users, adjustments, orders, activities] = await Promise.all([
    db.user.findMany({
      orderBy: { lastLoginAt: "desc" },
      take: 1000,
      select: { address: true, worldId: true, createdAt: true, lastLoginAt: true },
    }),
    getPointsAdjustments(),
    getAllPointsOrders(),
    getStoredActivities(500),
  ]);

  const windowStart = startOfRollingWindow(alphaRules.windowDays);
  const recentSwapStart = startOfRollingWindow(alphaRules.recentSwapDays);
  const byAddress = new Map<string, AlphaRow>();

  function ensure(addressInput: string) {
    const address = String(addressInput || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) return null;
    let row = byAddress.get(address);
    if (!row) {
      row = {
        address,
        score: 0,
        balanceScore: 0,
        swapScore: 0,
        recentSwapOk: false,
        spendPoints: 0,
        boxesOpened: 0,
        boxesPending: 0,
        lastActivityAt: null,
      };
      byAddress.set(address, row);
    }
    return row;
  }

  users.forEach((user) => ensure(user.address));
  adjustments.forEach((item) => {
    const row = ensure(item.address);
    if (!row) return;
    const time = rowTime(item.createdAt);
    if (!row.lastActivityAt || time > rowTime(row.lastActivityAt)) row.lastActivityAt = item.createdAt;
    if (isAlpha(null, item.createdBy) && time >= windowStart) {
      const rawPoints = Math.floor(Number(item.points || 0));
      const points = positivePoints(rawPoints);
      if (isAlpha("balance", item.createdBy)) {
        row.score += points;
        row.balanceScore += points;
      }
      if (isAlpha("swap", item.createdBy)) {
        row.score += points;
        row.swapScore += points;
      }
      if (isAlpha("swap", item.createdBy) && time >= recentSwapStart) row.recentSwapOk = true;
      if (String(item.createdBy || "").startsWith("alpha:spend:") && rawPoints < 0) {
        const spend = Math.abs(rawPoints);
        row.score = Math.max(0, row.score - spend);
        row.spendPoints += spend;
      }
    }
  });

  orders.forEach((order) => {
    const row = ensure(order.address);
    if (!row) return;
    if (order.type === "blind_box") {
      if (order.status === "opened") row.boxesOpened += 1;
      else row.boxesPending += 1;
    }
    const time = rowTime(order.openedAt || order.createdAt);
    if (!row.lastActivityAt || time > rowTime(row.lastActivityAt)) row.lastActivityAt = order.openedAt || order.createdAt;
  });

  activities.forEach((activity) => {
    const row = ensure(activity.address || "");
    if (!row) return;
    const time = rowTime(activity.createdAt);
    if (String(activity.type || "").toLowerCase() === "swap" && time >= recentSwapStart) row.recentSwapOk = true;
    if (!row.lastActivityAt || time > rowTime(row.lastActivityAt)) row.lastActivityAt = activity.createdAt.toISOString();
  });

  const rows = Array.from(byAddress.values())
    .sort((a, b) => b.score - a.score || rowTime(b.lastActivityAt) - rowTime(a.lastActivityAt));
  const eligible = rows.filter((row) => row.score >= alphaRules.minScoreToOpenBox && row.recentSwapOk).length;
  const active = rows.filter((row) => row.score > 0).length;
  const totalScore = rows.reduce((sum, row) => sum + row.score, 0);

  return jsonResponse({
    config: {
      ...alphaRules,
    },
    stats: {
      users: rows.length,
      active,
      eligible,
      totalScore,
      openedBoxes: rows.reduce((sum, row) => sum + row.boxesOpened, 0),
      pendingBoxes: rows.reduce((sum, row) => sum + row.boxesPending, 0),
      spentPoints: rows.reduce((sum, row) => sum + row.spendPoints, 0),
    },
    topUsers: rows.slice(0, 80),
    recentAdjustments: adjustments
      .filter((row) => isAlpha(null, row.createdBy))
      .sort((a, b) => rowTime(b.createdAt) - rowTime(a.createdAt))
      .slice(0, 120),
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { alphaRules?: unknown };
  if (!body || typeof body.alphaRules !== "object" || body.alphaRules === null) {
    return jsonResponse({ error: "Invalid Alpha rules." }, { status: 400 });
  }
  const config = await updateSystemConfig({ alphaRules: body.alphaRules });
  await auditLog(admin.id, "update_alpha_rules", "system_config", body.alphaRules);
  return jsonResponse({ config: normalizeAlphaRules(config.alphaRules) });
}
