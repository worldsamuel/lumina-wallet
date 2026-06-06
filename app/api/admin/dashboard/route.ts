import { isAddress, type Address } from "viem";
import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getRecentUserActivity } from "@/lib/admin/activity";
import { ensureFeedbackSchema } from "@/lib/admin/ensure-feedback-schema";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalUsers, todayUsers, users] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: today } } }),
    db.user.findMany({
      orderBy: { lastLoginAt: "desc" },
      take: 200,
      select: { address: true },
    }),
  ]);

  const addresses = users
    .map((user) => user.address)
    .filter((address): address is Address => isAddress(address));

  let activity: Awaited<ReturnType<typeof getRecentUserActivity>> = [];
  try {
    activity = await getRecentUserActivity(addresses, 200);
  } catch (error) {
    console.error("Failed to count dashboard transactions", error);
  }
  const transactions = activity.length;
  const todayIso = today.toISOString().slice(0, 10);
  const todayActivity = activity.filter((row) => row.createdAt.slice(0, 10) === todayIso);
  const feeNative = activity.reduce((sum, row) => sum + (row.feeNative || 0), 0);
  const todayFeeNative = todayActivity.reduce((sum, row) => sum + (row.feeNative || 0), 0);
  const volumeBySymbol = new Map<string, number>();
  for (const row of activity) {
    volumeBySymbol.set(row.tokenSymbol, (volumeBySymbol.get(row.tokenSymbol) || 0) + Math.abs(row.tokenAmount || 0));
  }
  const transferVolumeLabel =
    [...volumeBySymbol.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([symbol, value]) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`)
      .join(" / ") || "0";
  const feeSeries = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const day = date.toISOString().slice(5, 10);
    const iso = date.toISOString().slice(0, 10);
    const rows = activity.filter((row) => row.createdAt.slice(0, 10) === iso);
    return {
      day,
      count: rows.length,
      feeNative: rows.reduce((sum, row) => sum + (row.feeNative || 0), 0),
    };
  });

  await ensureFeedbackSchema().catch((error) => console.error("Failed to ensure feedback schema", error));
  const [analytics, feedbackNew] = await Promise.all([
    db.contentPage.findUnique({ where: { key: "analytics_counters" } }),
    db.feedback.count({ where: { status: "new" } }),
  ]).catch(() => [null, 0] as const);
  const counters = (typeof analytics?.bodyI18n === "object" && analytics.bodyI18n ? analytics.bodyI18n : {}) as {
    opens?: number;
    visits?: number;
    todayOpens?: number;
    todayVisits?: number;
    day?: string;
  };
  const isToday = counters.day === today.toISOString().slice(0, 10);

  return jsonResponse({
    totalUsers,
    todayUsers,
    transactions,
    todayTransactions: todayActivity.length,
    transferVolumeLabel,
    feeNative,
    todayFeeNative,
    feeSeries,
    opens: Number(counters.opens || 0),
    visits: Number(counters.visits || 0),
    todayOpens: isToday ? Number(counters.todayOpens || 0) : 0,
    todayVisits: isToday ? Number(counters.todayVisits || 0) : 0,
    feedbackNew,
  });
}
