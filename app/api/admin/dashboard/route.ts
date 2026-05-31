import { isAddress, type Address } from "viem";
import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getRecentUserActivity } from "@/lib/admin/activity";
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
      take: 30,
      select: { address: true },
    }),
  ]);

  const addresses = users
    .map((user) => user.address)
    .filter((address): address is Address => isAddress(address));

  let transactions = 0;
  try {
    transactions = (await getRecentUserActivity(addresses, 200)).length;
  } catch (error) {
    console.error("Failed to count dashboard transactions", error);
  }

  const [opens, visits, todayOpens, todayVisits, feedbackNew] = await Promise.all([
    db.analyticsEvent.count({ where: { event: "open" } }),
    db.analyticsEvent.count({ where: { event: "visit" } }),
    db.analyticsEvent.count({ where: { event: "open", createdAt: { gte: today } } }),
    db.analyticsEvent.count({ where: { event: "visit", createdAt: { gte: today } } }),
    db.feedback.count({ where: { status: "new" } }),
  ]).catch(() => [0, 0, 0, 0, 0] as const);

  return jsonResponse({
    totalUsers,
    todayUsers,
    transactions,
    opens,
    visits,
    todayOpens,
    todayVisits,
    feedbackNew,
  });
}
