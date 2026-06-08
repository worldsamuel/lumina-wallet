import { NextRequest } from "next/server";
import { isAddress } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getSystemConfig } from "@/lib/admin/system-config";
import { awardFixedPoints, getPointsAdjustments, getPointsOrders } from "@/lib/admin/points-products";
import { getStoredActivities } from "@/lib/admin/activity-store";
import { db } from "@/lib/db";

const checkinRewards = [10, 15, 20, 25, 30, 40, 100];

export function OPTIONS() {
  return optionsResponse();
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function todayStart() {
  const day = dayKey();
  return new Date(`${day}T00:00:00.000Z`);
}

function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dayKey(date);
}

function i18nText(map: Record<string, string> | undefined, fallback: string) {
  return map?.en || map?.["zh-CN"] || fallback;
}

function checkinDays(adjustments: Awaited<ReturnType<typeof getPointsAdjustments>>) {
  const days = new Set<string>();
  for (const row of adjustments) {
    const key = String(row.createdBy || "");
    const match = key.match(/^points-task:daily-checkin:(\d{4}-\d{2}-\d{2})$/);
    if (match) days.add(match[1]);
  }
  return days;
}

function nextCheckinDay(adjustments: Awaited<ReturnType<typeof getPointsAdjustments>>, today: string) {
  const days = checkinDays(adjustments);
  let cursor = previousDay(today);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return (streak % 7) + 1;
}

async function hasRecentActivity(address: string, type: "swap" | "earn") {
  const start = todayStart().getTime();
  const rows = await getStoredActivities(300);
  return rows.some((row) => {
    const rowAddress = String(row.address || "").toLowerCase();
    if (rowAddress !== address) return false;
    if (new Date(row.createdAt).getTime() < start) return false;
    const rowType = String(row.type || "").toLowerCase();
    if (type === "swap") return rowType === "swap";
    return rowType === "earn" || rowType === "deposit" || rowType === "withdraw";
  });
}

async function validateTask(address: string, taskId: string, type: string, proof: string | null) {
  if (taskId === "daily-checkin" || type === "checkin") return { ok: true };
  if (type === "swap") return { ok: await hasRecentActivity(address, "swap"), reason: "Complete a swap first." };
  if (type === "earn") return { ok: await hasRecentActivity(address, "earn"), reason: "Complete an Earn transaction first." };
  if (taskId === "bind-world-app") {
    const user = await db.user.findUnique({ where: { address } });
    return { ok: !!user, reason: "Connect World App first." };
  }
  if (taskId === "open-mystery-box") {
    const orders = await getPointsOrders(address);
    return { ok: orders.some((order) => order.type === "blind_box" && order.status === "opened"), reason: "Open a mystery box first." };
  }
  if (taskId === "share-friends" || taskId === "invite-friend" || taskId === "follow-twitter" || type === "social") {
    return { ok: proof === "visited", reason: "Open the task link first, then come back to claim." };
  }
  return { ok: proof === "visited", reason: "Complete the task first." };
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:points-task-complete", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "").toLowerCase();
  const taskId = String(body.taskId || "").trim().toLowerCase();
  const proof = body.proof ? String(body.proof).slice(0, 40) : null;
  if (!isAddress(address)) return jsonResponse({ error: "Invalid wallet address." }, { status: 400 });
  if (!taskId) return jsonResponse({ error: "Missing task id." }, { status: 400 });

  try {
    const config = await getSystemConfig();
    const task = config.pointsTasks.find((item) => item.id === taskId && item.enabled !== false);
    if (!task) return jsonResponse({ error: "Task unavailable." }, { status: 404 });

    const today = dayKey();
    const adjustments = await getPointsAdjustments(address);
    const isCheckin = task.id === "daily-checkin" || task.type === "checkin";
    const uniqueKey = isCheckin ? `points-task:daily-checkin:${today}` : `points-task:${task.id}`;
    if (adjustments.some((row) => row.createdBy === uniqueKey)) {
      return jsonResponse({ ok: true, skipped: true, completed: true, points: 0 });
    }

    const validation = await validateTask(address, task.id, task.type, proof);
    if (!validation.ok) return jsonResponse({ error: validation.reason || "Task is not complete yet." }, { status: 400 });

    const checkinDay = isCheckin ? nextCheckinDay(adjustments, today) : null;
    const points = isCheckin ? checkinRewards[(checkinDay || 1) - 1] : task.points;
    const note = isCheckin ? "Daily check-in" : i18nText(task.titleI18n, "Task reward");
    const result = await awardFixedPoints({
      address,
      points,
      note,
      uniqueKey,
    });

    return jsonResponse({
      ok: true,
      completed: true,
      taskId: task.id,
      points: result.points,
      skipped: result.skipped,
      checkinDay,
      row: result.row,
    });
  } catch (error) {
    console.error("Failed to complete points task", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Task completion failed." }, { status: 500 });
  }
}
