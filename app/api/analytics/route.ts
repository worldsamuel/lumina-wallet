import { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "analytics", 120).ok) {
    return jsonResponse({ ok: false }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { event?: string; path?: string };
  const event = String(body.event || "visit").slice(0, 40);
  const path = String(body.path || req.headers.get("referer") || "/").slice(0, 180);
  const session = getSessionFromRequest(req);

  await db.analyticsEvent.create({
    data: {
      event,
      path,
      address: session?.address ?? null,
      userAgent: req.headers.get("user-agent")?.slice(0, 240) ?? null,
    },
  }).catch((error: unknown) => {
    console.error("Failed to record analytics event", error);
  });

  return jsonResponse({ ok: true });
}
