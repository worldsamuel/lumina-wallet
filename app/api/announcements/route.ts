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

  try {
    const announcements = await db.announcement.findMany({
      orderBy: { publishedAt: "desc" },
    });
    return jsonResponse(announcements);
  } catch (error) {
    console.error("Failed to load announcements, using fallback", error);
    return jsonResponse([
      {
        id: 1,
        tag: "notice",
        titleI18n: { en: "Welcome to Lumina", "zh-CN": "欢迎使用 Lumina" },
        bodyI18n: { en: "Lumina is running with local fallback content.", "zh-CN": "Lumina 正在使用本地兜底公告。" },
        publishedAt: new Date(0).toISOString(),
      },
    ]);
  }
}
