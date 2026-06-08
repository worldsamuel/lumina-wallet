import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { checkinRewardForDay, getSystemConfig } from "@/lib/admin/system-config";
import { awardFixedPoints, getPointsAdjustments } from "@/lib/admin/points-products";

function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function nextCheckinDay(adjustments: Awaited<ReturnType<typeof getPointsAdjustments>>, today: string) {
  const days = new Set<string>();
  for (const row of adjustments) {
    const match = String(row.createdBy || "").match(/^points-task:daily-checkin:(\d{4}-\d{2}-\d{2})$/);
    if (match) days.add(match[1]);
  }
  let cursor = previousDay(today);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return (streak % 7) + 1;
}

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:points-checkin", 30).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "").toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  try {
    const config = await getSystemConfig();
    const adjustments = await getPointsAdjustments(address);
    const checkinDay = nextCheckinDay(adjustments, day);
    const result = await awardFixedPoints({
      address,
      points: checkinRewardForDay(config, checkinDay),
      note: "Daily check-in",
      uniqueKey: `points-task:daily-checkin:${day}`,
    });
    return jsonResponse({ ok: true, checkinDay, ...result });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Check-in failed." }, { status: 400 });
  }
}
