import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

const ANALYTICS_KEY = "analytics_counters";

type AnalyticsCounters = {
  opens: number;
  visits: number;
  todayOpens: number;
  todayVisits: number;
  day: string;
};

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "analytics", 120).ok) {
    return jsonResponse({ ok: false }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { event?: string; path?: string };
  const event = String(body.event || "visit").slice(0, 40);
  const today = new Date().toISOString().slice(0, 10);

  const page = await db.contentPage.findUnique({ where: { key: ANALYTICS_KEY } }).catch(() => null);
  const current = (typeof page?.bodyI18n === "object" && page.bodyI18n ? page.bodyI18n : {}) as Partial<AnalyticsCounters>;
  const resetDay = current.day === today;
  const next: AnalyticsCounters = {
    opens: Number(current.opens || 0) + (event === "open" ? 1 : 0),
    visits: Number(current.visits || 0) + (event === "visit" ? 1 : 0),
    todayOpens: (resetDay ? Number(current.todayOpens || 0) : 0) + (event === "open" ? 1 : 0),
    todayVisits: (resetDay ? Number(current.todayVisits || 0) : 0) + (event === "visit" ? 1 : 0),
    day: today,
  };

  await db.contentPage.upsert({
    where: { key: ANALYTICS_KEY },
    update: { bodyI18n: next },
    create: { key: ANALYTICS_KEY, bodyI18n: next },
  }).catch(() => {
    console.warn("[analytics] record failed");
  });

  return jsonResponse({ ok: true });
}
