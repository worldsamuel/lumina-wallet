import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:announcements", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const announcements = await db.announcement.findMany({
    orderBy: { publishedAt: "desc" },
  });
  return jsonResponse(announcements);
}
